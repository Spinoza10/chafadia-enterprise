import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../context/StoreContext";



function ProductCard({ product }) {
  const navigate = useNavigate();

  const {
    addToCart,
    toggleWishlist,
    isWishlisted,
    toggleCompare,
    addRecentlyViewed,
    getProductRating,
    formatMoney,
  } = useStore();

  const [showQuickView, setShowQuickView] = useState(false);
  const [selectedImage, setSelectedImage] = useState(product?.image || "");
  const [selectedVariant, setSelectedVariant] = useState(
    product?.variants?.[0] || "Standard"
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const fallbackImage =
    "https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=900&q=80";

  // State resets when the product changes because every <ProductCard> is keyed by product id.

  // hooks must run before any early return
  const gallery = useMemo(() => {
    const images = [
      ...(product?.gallery || []),
      product?.image,
      product?.secondImage,
    ].filter(Boolean);

    return [...new Set(images)];
  }, [product?.gallery, product?.image, product?.secondImage]);

  if (!product) return null;

  // price is the server's selling price; compareAtPrice is the pre-discount price
  const finalPrice = Number(product.price || 0);
  const discount = Number(product.discount || 0);
  const stock = Number(product.stock || 0);

  const activeImage = selectedImage || product.image || gallery[0] || fallbackImage;
  const oldPrice = product.compareAtPrice || null;
  const isOutOfStock = stock <= 0 || product.status === "Out of Stock";
  const isLowStock = stock > 0 && stock <= 5;
  const stockPercent = Math.min(100, Math.max(8, stock * 5));

  const rating =
    typeof getProductRating === "function"
      ? Number(getProductRating(product.id) || product.rating || 5)
      : Number(product.rating || 5);

  const stars = "★★★★★".slice(0, Math.max(1, Math.round(rating)));
  const variants = product.variants?.length ? product.variants : ["Standard"];
  const wished =
    typeof isWishlisted === "function" ? Boolean(isWishlisted(product.id)) : false;

  const money = (amount) =>
    typeof formatMoney === "function"
      ? formatMoney(amount)
      : `${Number(amount || 0).toLocaleString()} FCFA`;

  const buildCartItem = () => ({
    ...product,
    qty: quantity,
    selectedVariant,
  });

  const handleAddToCart = () => {
    if (isOutOfStock) {
      alert("This product is currently out of stock.");
      return;
    }

    addToCart(buildCartItem(), quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  const handleBuyNow = () => {
    if (isOutOfStock) {
      alert("This product is currently out of stock.");
      return;
    }

    addToCart(buildCartItem(), quantity);
    navigate("/checkout");
  };

  const handleQuickView = () => {
    if (typeof addRecentlyViewed === "function") addRecentlyViewed(product);
    setSelectedImage(product.image || gallery[0] || fallbackImage);
    setShowQuickView(true);
  };

  const handleWishlist = () => {
    if (typeof toggleWishlist === "function") toggleWishlist(product);
  };

  const handleCompare = () => {
    if (typeof toggleCompare === "function") toggleCompare(product);
  };

  const increaseQty = () => setQuantity((value) => Math.min(stock || 99, value + 1));
  const decreaseQty = () => setQuantity((value) => Math.max(1, value - 1));

  return (
    <>
      <style>{`
        .ce-product-card {
          width: 100%;
          max-width: 318px;
          margin: 0 auto;
          position: relative;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.93)),
            radial-gradient(circle at top right, rgba(212,175,55,0.2), transparent 34%);
          border: 1px solid rgba(212, 175, 55, 0.3);
          border-radius: 30px;
          box-shadow: 0 22px 55px rgba(0, 31, 77, 0.11), inset 0 1px 0 rgba(255,255,255,0.92);
          transition: 0.38s ease;
          isolation: isolate;
        }

        .ce-product-card::before {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: 29px;
          border: 1px solid rgba(255,255,255,0.7);
          pointer-events: none;
          z-index: 2;
        }

        .ce-product-card::after {
          content: "";
          position: absolute;
          width: 210px;
          height: 210px;
          right: -105px;
          top: -105px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(212,175,55,0.22), rgba(212,175,55,0.02) 64%, transparent);
          z-index: -1;
          transition: 0.38s ease;
        }

        .ce-product-card:hover {
          transform: translateY(-9px);
          box-shadow: 0 34px 82px rgba(0, 31, 77, 0.18), 0 0 0 1px rgba(212,175,55,0.32);
          border-color: rgba(212, 175, 55, 0.58);
        }

        .ce-product-card:hover::after {
          transform: scale(1.18);
        }

        .ce-media-wrap {
          padding: 10px 10px 0;
        }

        .ce-product-media {
          position: relative;
          height: 222px;
          overflow: hidden;
          border-radius: 24px;
          background:
            radial-gradient(circle at 24% 20%, rgba(212,175,55,0.25), transparent 36%),
            linear-gradient(135deg, #f8fbff, #ffffff);
          box-shadow: inset 0 0 0 1px rgba(0,74,173,0.08);
        }

        .ce-product-media img,
        .ce-product-media video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: 0.58s ease;
        }

        .ce-image-loading {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, #f3f4f6, #ffffff, #f3f4f6);
          background-size: 220% 100%;
          animation: ceShimmer 1.2s infinite linear;
        }

        @keyframes ceShimmer {
          from { background-position: 220% 0; }
          to { background-position: -220% 0; }
        }

        .ce-hover-image {
          position: absolute;
          inset: 0;
          opacity: 0;
        }

        .ce-product-card:hover .ce-main-image {
          transform: scale(1.07);
        }

        .ce-product-card:hover .ce-hover-image {
          opacity: 1;
          transform: scale(1.07);
        }

        .ce-media-shade {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(0,31,77,0) 34%, rgba(0,31,77,0.72)),
            linear-gradient(135deg, rgba(212,175,55,0.08), transparent 45%);
          opacity: 0;
          transition: 0.35s ease;
        }

        .ce-product-card:hover .ce-media-shade {
          opacity: 1;
        }

        .ce-badges {
          position: absolute;
          left: 12px;
          top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          z-index: 4;
        }

        .ce-badge {
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 9.5px;
          font-weight: 1000;
          letter-spacing: 0.25px;
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 22px rgba(0,0,0,0.14);
          border: 1px solid rgba(255,255,255,0.38);
        }

        .ce-badge.gold {
          background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
          color: #001f4d;
        }

        .ce-badge.blue {
          background: linear-gradient(135deg, #004aad, #001f4d);
          color: #ffffff;
        }

        .ce-badge.green {
          background: rgba(220,252,231,0.96);
          color: #166534;
        }

        .ce-badge.red {
          background: rgba(254,226,226,0.96);
          color: #991b1b;
        }

        .ce-favorite {
          position: absolute;
          right: 12px;
          top: 12px;
          z-index: 5;
          width: 39px;
          height: 39px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.64);
          background: rgba(255,255,255,0.94);
          color: #001f4d;
          font-size: 19px;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 12px 24px rgba(0,31,77,0.16);
          transition: 0.3s ease;
        }

        .ce-favorite:hover,
        .ce-favorite.active {
          background: linear-gradient(135deg, #fff7d6, #d4af37);
          transform: scale(1.09) rotate(-4deg);
        }

        .ce-floating-actions {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 12px;
          z-index: 6;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          transform: translateY(20px);
          opacity: 0;
          transition: 0.34s ease;
        }

        .ce-product-card:hover .ce-floating-actions {
          transform: translateY(0);
          opacity: 1;
        }

        .ce-float-btn {
          border: 1px solid rgba(255,255,255,0.36);
          background: rgba(255,255,255,0.14);
          color: #ffffff;
          backdrop-filter: blur(12px);
          border-radius: 999px;
          min-height: 36px;
          font-size: 11px;
          font-weight: 950;
          cursor: pointer;
          transition: 0.3s ease;
        }

        .ce-float-btn:hover {
          background: linear-gradient(135deg, #fff7d6, #d4af37);
          color: #001f4d;
          transform: translateY(-2px);
        }

        .ce-product-body {
          padding: 14px 15px 16px;
        }

        .ce-category-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 9px;
        }

        .ce-category {
          max-width: 158px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: inline-flex;
          padding: 7px 10px;
          border-radius: 999px;
          background: #fff7d6;
          color: #92400e;
          font-size: 10px;
          font-weight: 950;
          border: 1px solid rgba(212,175,55,0.22);
        }

        .ce-rating {
          color: #d4af37;
          font-size: 11px;
          letter-spacing: 0.6px;
          font-weight: 950;
          white-space: nowrap;
        }

        .ce-product-name {
          color: #001f4d;
          font-size: 17px;
          line-height: 1.18;
          font-weight: 1000;
          margin: 0 0 7px;
          min-height: 40px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .ce-description {
          color: #667085;
          font-size: 12.5px;
          line-height: 1.48;
          font-weight: 650;
          min-height: 38px;
          margin-bottom: 12px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .ce-price-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
          padding: 12px;
          border-radius: 20px;
          background: linear-gradient(135deg, rgba(255,247,214,0.72), rgba(255,255,255,0.88));
          border: 1px solid rgba(212,175,55,0.2);
        }

        .ce-price-label {
          display: block;
          color: #667085;
          font-size: 10px;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          font-weight: 950;
          margin-bottom: 3px;
        }

        .ce-price {
          color: #b8860b;
          font-size: 20px;
          font-weight: 1000;
          line-height: 1;
        }

        .ce-old-price {
          color: #98a2b3;
          font-size: 11px;
          font-weight: 850;
          text-decoration: line-through;
          margin-top: 4px;
        }

        .ce-savings {
          color: #166534;
          background: #dcfce7;
          border-radius: 999px;
          padding: 6px 8px;
          font-size: 10px;
          font-weight: 950;
          white-space: nowrap;
        }

        .ce-stock-panel {
          padding: 10px;
          border-radius: 17px;
          background: #f8fbff;
          border: 1px solid rgba(0,74,173,0.08);
          margin-bottom: 11px;
        }

        .ce-stock-top {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          color: #001f4d;
          font-size: 11px;
          font-weight: 900;
          margin-bottom: 8px;
        }

        .ce-stock-top span:first-child {
          color: #667085;
        }

        .ce-stock-bar {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: #e5e7eb;
          overflow: hidden;
        }

        .ce-stock-fill {
          height: 100%;
          width: var(--stock-width, 50%);
          border-radius: 999px;
          background: linear-gradient(135deg, #004aad, #d4af37);
        }

        .ce-options-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin-bottom: 11px;
        }

        .ce-variant-select {
          width: 100%;
          min-height: 36px;
          border-radius: 999px;
          border: 1px solid rgba(0,74,173,0.12);
          background: #ffffff;
          color: #001f4d;
          font-size: 11px;
          font-weight: 850;
          padding: 0 11px;
          outline: none;
        }

        .ce-qty {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid rgba(0,74,173,0.12);
        }

        .ce-qty button {
          width: 27px;
          height: 27px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg, #004aad, #001f4d);
          color: #ffffff;
          font-weight: 950;
          cursor: pointer;
          transition: 0.2s ease;
        }

        .ce-qty button:hover {
          transform: scale(1.08);
        }

        .ce-qty span {
          min-width: 19px;
          text-align: center;
          color: #001f4d;
          font-size: 11px;
          font-weight: 950;
        }

        .ce-service-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 7px;
          margin-bottom: 11px;
        }

        .ce-service {
          padding: 8px 6px;
          border-radius: 14px;
          background: linear-gradient(135deg, #ffffff, #f8fbff);
          border: 1px solid rgba(0,74,173,0.08);
          color: #001f4d;
          font-size: 10px;
          font-weight: 850;
          text-align: center;
        }

        .ce-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .ce-btn {
          border: none;
          min-height: 41px;
          border-radius: 999px;
          font-size: 11.8px;
          font-weight: 1000;
          cursor: pointer;
          transition: 0.3s ease;
        }

        .ce-btn:hover {
          transform: translateY(-2px);
          filter: brightness(1.04);
        }

        .ce-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }

        .ce-cart-btn {
          background: linear-gradient(135deg, #004aad, #001f4d);
          color: #ffffff;
          box-shadow: 0 14px 28px rgba(0,31,77,0.16);
        }

        .ce-buy-btn {
          background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
          color: #001f4d;
          box-shadow: 0 14px 28px rgba(212,175,55,0.22);
        }

        .ce-added-toast {
          position: absolute;
          left: 50%;
          top: 47%;
          z-index: 30;
          transform: translate(-50%, -50%);
          padding: 12px 15px;
          border-radius: 999px;
          background: linear-gradient(135deg, #dcfce7, #bbf7d0);
          color: #166534;
          border: 1px solid rgba(22,101,52,0.18);
          box-shadow: 0 20px 46px rgba(0,31,77,0.2);
          font-size: 12px;
          font-weight: 1000;
          white-space: nowrap;
        }

        .ce-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0,31,77,0.68);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .ce-modal {
          width: min(980px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          background: #ffffff;
          border-radius: 34px;
          border: 1px solid rgba(212,175,55,0.38);
          box-shadow: 0 36px 100px rgba(0,31,77,0.38);
          display: grid;
          grid-template-columns: 0.98fr 1.02fr;
        }

        .ce-modal-media {
          min-height: 460px;
          background:
            radial-gradient(circle at top right, rgba(212,175,55,0.25), transparent 35%),
            linear-gradient(135deg, #004aad, #001f4d);
          overflow: hidden;
          border-radius: 34px 0 0 34px;
          padding: 14px;
          display: grid;
          gap: 10px;
        }

        .ce-modal-main-img {
          width: 100%;
          min-height: 350px;
          object-fit: cover;
          border-radius: 24px;
          background: #ffffff;
          box-shadow: 0 20px 50px rgba(0,0,0,0.16);
        }

        .ce-thumbs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .ce-thumbs button {
          border: 2px solid transparent;
          border-radius: 15px;
          overflow: hidden;
          background: #ffffff;
          cursor: pointer;
          padding: 0;
        }

        .ce-thumbs button.active {
          border-color: #d4af37;
        }

        .ce-thumbs img {
          width: 100%;
          height: 65px;
          object-fit: cover;
          display: block;
        }

        .ce-modal-body {
          padding: 27px;
        }

        .ce-modal-body h2 {
          color: #001f4d;
          font-size: clamp(26px, 4vw, 34px);
          line-height: 1.1;
          font-weight: 1000;
          margin: 12px 0;
        }

        .ce-modal-body p {
          color: #667085;
          line-height: 1.75;
          font-weight: 650;
          margin-bottom: 14px;
        }

        .ce-info-lines {
          display: grid;
          gap: 8px;
          margin: 16px 0;
        }

        .ce-info-line {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          padding: 10px 0;
          border-bottom: 1px dashed rgba(0,31,77,0.14);
          color: #001f4d;
          font-weight: 850;
          font-size: 13px;
        }

        .ce-info-line span {
          color: #667085;
        }

        .ce-modal-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 17px;
        }

        .ce-close-btn {
          margin-top: 10px;
          width: 100%;
          border: none;
          min-height: 44px;
          border-radius: 999px;
          background: #fee2e2;
          color: #991b1b;
          font-weight: 1000;
          cursor: pointer;
        }

        @media (max-width: 720px) {
          .ce-product-card {
            max-width: 100%;
          }

          .ce-product-media {
            height: 198px;
          }

          .ce-modal {
            grid-template-columns: 1fr;
          }

          .ce-modal-media {
            border-radius: 34px 34px 0 0;
            min-height: auto;
          }

          .ce-modal-main-img {
            min-height: 255px;
          }

          .ce-actions,
          .ce-modal-actions,
          .ce-service-row,
          .ce-options-row {
            grid-template-columns: 1fr;
          }

          .ce-floating-actions {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <article className="ce-product-card">
        {added && <div className="ce-added-toast">Added to cart ✓</div>}

        <div className="ce-media-wrap">
          <div className="ce-product-media">
            {!imageLoaded && <div className="ce-image-loading" />}

            {product.video ? (
              <video src={product.video} muted loop className="ce-main-image" />
            ) : (
              <>
                <img
                  className="ce-main-image"
                  src={product.image || fallbackImage}
                  alt={product.name || "Chafadia product"}
                  onLoad={() => setImageLoaded(true)}
                />

                {product.secondImage && (
                  <img
                    className="ce-hover-image"
                    src={product.secondImage}
                    alt={product.name || "Chafadia product"}
                  />
                )}
              </>
            )}

            <div className="ce-media-shade" />

            <div className="ce-badges">
              {discount > 0 && <span className="ce-badge gold">-{discount}%</span>}
              {product.badge && <span className="ce-badge blue">{product.badge}</span>}
              {isLowStock && <span className="ce-badge gold">Limited</span>}
              <span className={isOutOfStock ? "ce-badge red" : "ce-badge green"}>
                {isOutOfStock ? "Sold Out" : "In Stock"}
              </span>
            </div>

            <button
              type="button"
              className={wished ? "ce-favorite active" : "ce-favorite"}
              onClick={handleWishlist}
              title="Save product"
            >
              {wished ? "♥" : "♡"}
            </button>

            <div className="ce-floating-actions">
              <button type="button" className="ce-float-btn" onClick={handleQuickView}>
                Quick View
              </button>

              <button type="button" className="ce-float-btn" onClick={handleCompare}>
                Compare
              </button>
            </div>
          </div>
        </div>

        <div className="ce-product-body">
          <div className="ce-category-row">
            <span className="ce-category">{product.category || "Chafadia"}</span>
            <span className="ce-rating">{stars}</span>
          </div>

          <h3 className="ce-product-name">{product.name || "Premium Product"}</h3>

          <p className="ce-description">
            {product.description ||
              "Premium CHAFADIA ENTERPRISE product created for quality, beauty, wellness and customer satisfaction."}
          </p>

          <div className="ce-price-row">
            <div>
              <span className="ce-price-label">Price</span>
              <div className="ce-price">{money(finalPrice)}</div>
              {oldPrice && <div className="ce-old-price">{money(oldPrice)}</div>}
            </div>

            {discount > 0 && <span className="ce-savings">Save {discount}%</span>}
          </div>

          <div className="ce-stock-panel">
            <div className="ce-stock-top">
              <span>Availability</span>
              <strong>{isOutOfStock ? "Out of stock" : `${stock} left`}</strong>
            </div>

            <div className="ce-stock-bar" style={{ "--stock-width": `${stockPercent}%` }}>
              <div className="ce-stock-fill" />
            </div>
          </div>

          <div className="ce-options-row">
            <select
              className="ce-variant-select"
              value={selectedVariant}
              onChange={(e) => setSelectedVariant(e.target.value)}
            >
              {variants.map((variant) => (
                <option key={variant} value={variant}>
                  {variant}
                </option>
              ))}
            </select>

            <div className="ce-qty">
              <button type="button" onClick={decreaseQty}>−</button>
              <span>{quantity}</span>
              <button type="button" onClick={increaseQty}>+</button>
            </div>
          </div>

          <div className="ce-service-row">
            <div className="ce-service">🌍 Worldwide</div>
            <div className="ce-service">🔒 Secure</div>
          </div>

          <div className="ce-actions">
            <button type="button" className="ce-btn ce-cart-btn" onClick={handleAddToCart} disabled={isOutOfStock}>
              Add Cart
            </button>

            <button type="button" className="ce-btn ce-buy-btn" onClick={handleBuyNow} disabled={isOutOfStock}>
              Buy Now
            </button>
          </div>
        </div>
      </article>

      {showQuickView && (
        <div className="ce-modal-overlay">
          <div className="ce-modal">
            <div className="ce-modal-media">
              <img className="ce-modal-main-img" src={activeImage || fallbackImage} alt={product.name || "Chafadia product"} />

              {gallery.length > 1 && (
                <div className="ce-thumbs">
                  {gallery.slice(0, 4).map((image, index) => (
                    <button
                      type="button"
                      key={`${image}-${index}`}
                      className={activeImage === image ? "active" : ""}
                      onClick={() => setSelectedImage(image)}
                    >
                      <img src={image} alt={`${product.name} ${index + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ce-modal-body">
              <span className="ce-category">{product.collection || product.category}</span>

              <h2>{product.name || "Premium Product"}</h2>

              <p>
                {product.description ||
                  "Premium CHAFADIA ENTERPRISE product selected for quality, elegance and everyday customer satisfaction."}
              </p>

              <div className="ce-price-row">
                <div>
                  <span className="ce-price-label">Selected Price</span>
                  <div className="ce-price">{money(finalPrice)}</div>
                  {oldPrice && <div className="ce-old-price">{money(oldPrice)}</div>}
                </div>

                {discount > 0 && <span className="ce-savings">Save {discount}%</span>}
              </div>

              <div className="ce-info-lines">
                <div className="ce-info-line"><span>Category</span><strong>{product.category || "General"}</strong></div>
                <div className="ce-info-line"><span>Collection</span><strong>{product.collection || "Premium"}</strong></div>
                <div className="ce-info-line"><span>Stock</span><strong>{isOutOfStock ? "Out of Stock" : `${stock} Available`}</strong></div>
                <div className="ce-info-line"><span>Selected Option</span><strong>{selectedVariant}</strong></div>
                <div className="ce-info-line"><span>Quantity</span><strong>{quantity}</strong></div>
                <div className="ce-info-line"><span>Delivery</span><strong>{product.delivery || "Nationwide & Worldwide Delivery"}</strong></div>
              </div>

              <div className="ce-modal-actions">
                <button type="button" className="ce-btn ce-cart-btn" onClick={handleAddToCart} disabled={isOutOfStock}>
                  Add to Cart
                </button>

                <button type="button" className="ce-btn ce-buy-btn" onClick={handleBuyNow} disabled={isOutOfStock}>
                  Buy Now
                </button>
              </div>

              <button type="button" className="ce-close-btn" onClick={() => setShowQuickView(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ProductCard;
