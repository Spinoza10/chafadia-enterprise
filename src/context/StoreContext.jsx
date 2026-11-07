import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../lib/api";
import { imageUrl } from "../lib/images";
import { useAuth } from "./AuthContext";

const StoreContext = createContext(null);

// Cart, wishlist and compare are per-browser conveniences. Prices and stock always come
// from the server, and the server recomputes every total at checkout.
const STORAGE_KEYS = { cart: "cart", wishlist: "wishlist", compare: "compare", recentlyViewed: "recentlyViewed" };

const safeParse = (key, fallback) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const safeSave = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the cart still works for this session
  }
};

/** API product -> the shape the storefront components use. */
function toStoreProduct(p) {
  const variant = p.variants?.[0] ?? {};
  const images = (p.images || []).map(imageUrl).filter(Boolean);
  const compareAt = variant.compareAtPrice && variant.compareAtPrice > variant.price ? variant.compareAtPrice : null;
  const available = variant.trackStock === false ? 999 : variant.available ?? 0;
  return {
    id: p.id,
    slug: p.slug,
    kind: p.kind,
    name: p.name,
    nameFr: p.nameFr,
    price: variant.price ?? p.price ?? 0,
    compareAtPrice: compareAt,
    discount: compareAt ? Math.round((1 - variant.price / compareAt) * 100) : 0,
    category: p.category?.name || "Other",
    categorySlug: p.category?.slug,
    collection: p.collection || "",
    stock: available,
    status: available > 0 ? "Available" : "Out of Stock",
    image: images[0] || "",
    secondImage: images[1] || "",
    gallery: images,
    description: p.description,
    variants: p.options?.length ? p.options : ["Standard"],
    variantId: variant.id,
    sku: variant.sku,
    featured: p.featured,
    badge: p.badge || "Premium",
    rating: Number(p.rating) || 5,
    reviewCount: p.reviewCount || 0,
  };
}

export function StoreProvider({ children }) {
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [orders, setOrders] = useState({ ownerId: null, list: [] });
  const [cart, setCart] = useState(() => safeParse(STORAGE_KEYS.cart, []));
  const [wishlist, setWishlist] = useState(() => safeParse(STORAGE_KEYS.wishlist, []));
  const [compare, setCompare] = useState(() => safeParse(STORAGE_KEYS.compare, []));
  const [recentlyViewed, setRecentlyViewed] = useState(() => safeParse(STORAGE_KEYS.recentlyViewed, []));

  useEffect(() => safeSave(STORAGE_KEYS.cart, cart), [cart]);
  useEffect(() => safeSave(STORAGE_KEYS.wishlist, wishlist), [wishlist]);
  useEffect(() => safeSave(STORAGE_KEYS.compare, compare), [compare]);
  useEffect(() => safeSave(STORAGE_KEYS.recentlyViewed, recentlyViewed), [recentlyViewed]);

  const applyProducts = useCallback((promise) =>
    promise
      .then((res) => {
        setProducts(res.data.map(toStoreProduct));
        setProductsError("");
      })
      .catch((err) => setProductsError(err.message))
      .finally(() => setProductsLoading(false)), []);

  const loadProducts = useCallback(() => applyProducts(api.get("/api/products?limit=200&sort=featured")), [applyProducts]);

  // Initial load, then a quiet refresh so "Sold out" badges appear while people browse.
  useEffect(() => {
    applyProducts(api.get("/api/products?limit=200&sort=featured"));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") applyProducts(api.get("/api/products?limit=200&sort=featured"));
    }, 90_000);
    return () => clearInterval(timer);
  }, [applyProducts]);

  const isCustomer = currentUser?.role === "customer";
  const userId = currentUser?.id;
  const fetchOrders = useCallback(
    () =>
      api.get("/api/orders/mine?limit=100").then(
        (res) => ({ ownerId: userId, list: res.data }),
        () => ({ ownerId: userId, list: [] })
      ),
    [userId]
  );

  const refreshOrders = useCallback(async () => {
    if (isCustomer) setOrders(await fetchOrders());
  }, [isCustomer, fetchOrders]);

  useEffect(() => {
    if (!isCustomer) return undefined;
    let current = true;
    fetchOrders().then((next) => current && setOrders(next));
    return () => {
      current = false;
    };
  }, [isCustomer, fetchOrders]);

  // ---------------------------------------------------------------- live availability
  // Every 20 s (and when the tab comes back into focus) ask the server whether the items in the
  // cart and wishlist are still available, so a customer learns immediately that something sold out.
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [availability, setAvailability] = useState({}); // variantId -> { status, available }
  const [dismissedAlerts, setDismissedAlerts] = useState(() => new Set());

  const watchedVariants = useMemo(() => {
    const ids = new Set(cart.map((i) => i.variantId).filter(Boolean));
    for (const w of wishlist) {
      const vid = productById.get(w.id)?.variantId;
      if (vid) ids.add(vid);
    }
    return [...ids].sort((a, b) => a - b).slice(0, 100);
  }, [cart, wishlist, productById]);
  const watchedKey = watchedVariants.join(",");

  useEffect(() => {
    if (!watchedKey) return undefined;
    let stopped = false;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api
        .get(`/api/products/availability?variants=${watchedKey}`)
        .then((res) => {
          if (stopped) return;
          setAvailability((prev) => ({ ...prev, ...Object.fromEntries(res.data.map((a) => [a.variantId, a])) }));
        })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 20_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [watchedKey]);

  // keep cart lines in sync with current server prices/stock; never drop a line silently
  const liveCart = useMemo(
    () =>
      cart.map((item) => {
        const p = productById.get(item.id);
        const live = availability[item.variantId];
        const merged = p ? { ...item, ...p, qty: item.qty, selectedVariant: item.selectedVariant, cartId: item.cartId } : { ...item };
        let stockStatus = "available";
        let maxQty = null;
        if (live) {
          stockStatus = live.status;
          maxQty = live.available;
        } else if (products.length && !p) {
          stockStatus = "unavailable";
        } else if (p && p.stock <= 0) {
          stockStatus = "sold_out";
        }
        if (stockStatus === "available" && maxQty !== null && item.qty > maxQty) stockStatus = "limited";
        if (stockStatus !== "available" && stockStatus !== "limited") maxQty = 0;
        return { ...merged, stock: maxQty ?? merged.stock, stockStatus, maxQty };
      }),
    [cart, productById, products.length, availability]
  );

  // Banner for items in the cart / wishlist that are sold out or no longer sold.
  const stockAlerts = useMemo(() => {
    const alerts = [];
    for (const item of liveCart) {
      if (item.stockStatus === "sold_out" || item.stockStatus === "unavailable") {
        alerts.push({ key: `cart:${item.variantId}:${item.stockStatus}`, name: item.name, where: "cart", status: item.stockStatus });
      }
    }
    for (const w of wishlist) {
      const vid = productById.get(w.id)?.variantId;
      const a = vid && availability[vid];
      if (a && a.status !== "available") alerts.push({ key: `wishlist:${vid}:${a.status}`, name: w.name, where: "wishlist", status: a.status });
    }
    return alerts.filter((a) => !dismissedAlerts.has(a.key));
  }, [liveCart, wishlist, availability, productById, dismissedAlerts]);

  const dismissStockAlert = (key) => setDismissedAlerts((prev) => new Set(prev).add(key));
  const cartIssues = liveCart.filter((i) => i.stockStatus !== "available");

  const lineKey = (item) => `${item.id}|${item.selectedVariant || "Standard"}`;

  const addToCart = (product, qty = 1) => {
    if (!product) return;
    const quantity = Math.max(1, Number(qty) || 1);
    const selectedVariant = product.selectedVariant || product.variants?.[0] || "Standard";
    setCart((prev) => {
      const key = lineKey({ id: product.id, selectedVariant });
      const exists = prev.find((i) => lineKey(i) === key);
      if (exists) return prev.map((i) => (lineKey(i) === key ? { ...i, qty: i.qty + quantity } : i));
      return [...prev, { id: product.id, variantId: product.variantId, name: product.name, price: product.price, image: product.image, selectedVariant, qty: quantity, cartId: `${key}|${Date.now()}` }];
    });
  };

  // numbers are cart line indexes, strings are cartIds (product ids are never used: they could collide with indexes)
  const matches = (item, index, key) => (typeof key === "number" ? index === key : item.cartId === key);
  const removeFromCart = (idOrIndex) => setCart((prev) => prev.filter((item, index) => !matches(item, index, idOrIndex)));
  const updateCartQuantity = (idOrIndex, qty) =>
    setCart((prev) => prev.map((item, index) => (matches(item, index, idOrIndex) ? { ...item, qty: Math.max(1, Number(qty) || 1) } : item)));
  const increaseCartQuantity = (idOrIndex) => setCart((prev) => prev.map((item, index) => (matches(item, index, idOrIndex) ? { ...item, qty: item.qty + 1 } : item)));
  const decreaseCartQuantity = (idOrIndex) => setCart((prev) => prev.map((item, index) => (matches(item, index, idOrIndex) ? { ...item, qty: Math.max(1, item.qty - 1) } : item)));
  const clearCart = () => setCart([]);
  const calculateCartTotal = () => liveCart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const getCartCount = () => liveCart.reduce((sum, item) => sum + item.qty, 0);
  /** Cart lines in the format the checkout API expects. */
  const cartForCheckout = () =>
    liveCart.map((item) => ({
      variantId: item.variantId,
      quantity: item.qty,
      ...(item.selectedVariant && item.selectedVariant !== "Standard" && { option: item.selectedVariant }),
    }));

  const toggleWishlist = (product) => {
    if (!product) return false;
    const exists = wishlist.some((item) => item.id === product.id);
    setWishlist((prev) => (exists ? prev.filter((item) => item.id !== product.id) : [{ id: product.id, name: product.name, image: product.image, price: product.price }, ...prev]));
    return !exists;
  };
  const isWishlisted = (id) => wishlist.some((item) => item.id === id);
  const toggleCompare = (product) => {
    if (!product) return false;
    const exists = compare.some((item) => item.id === product.id);
    if (!exists && compare.length >= 4) {
      alert("You can compare up to 4 products.");
      return false;
    }
    setCompare((prev) => (exists ? prev.filter((item) => item.id !== product.id) : [{ id: product.id, name: product.name }, ...prev]));
    return !exists;
  };
  const clearCompare = () => setCompare([]);
  const addRecentlyViewed = (product) => {
    if (!product) return;
    setRecentlyViewed((prev) => [{ id: product.id, name: product.name, image: product.image }, ...prev.filter((i) => i.id !== product.id)].slice(0, 12));
  };
  const getProductRating = (id) => productById.get(id)?.rating ?? 5;

  const productCategories = useMemo(() => ["All", ...new Set(products.map((p) => p.category))], [products]);
  const productCollections = useMemo(() => [...new Set(products.map((p) => p.collection).filter(Boolean))], [products]);
  const searchProducts = (query) => {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.category} ${p.collection} ${p.description}`.toLowerCase().includes(q));
  };
  const getFeaturedProducts = (limit = 12) => products.filter((p) => p.featured).slice(0, limit);
  const getProductsByCategory = (category) => (category === "All" ? products : products.filter((p) => p.category === category));
  const getRelatedProducts = (product, limit = 8) =>
    product ? products.filter((p) => p.id !== product.id && (p.category === product.category || p.collection === product.collection)).slice(0, limit) : [];

  const value = {
    products, productsLoading, productsError, loadProducts,
    // previous customer's orders are never shown after logout or to staff accounts
    orders: isCustomer && orders.ownerId === currentUser.id ? orders.list : [], refreshOrders,
    cart: liveCart, addToCart, removeFromCart, updateCartQuantity, increaseCartQuantity, decreaseCartQuantity, clearCart,
    calculateCartTotal, getCartCount, cartForCheckout, cartIssues, stockAlerts, dismissStockAlert,
    wishlist, toggleWishlist, isWishlisted, compare, toggleCompare, clearCompare, recentlyViewed, addRecentlyViewed,
    getProductRating, productCategories, productCollections, searchProducts, getFeaturedProducts, getProductsByCategory, getRelatedProducts,
    formatMoney,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// The hook intentionally shares this context module's public API; keep the
// fast-refresh rule scoped to this non-component export.
// eslint-disable-next-line react-refresh/only-export-components
export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside StoreProvider");
  return context;
};
