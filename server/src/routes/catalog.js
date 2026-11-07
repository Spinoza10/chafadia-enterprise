// Public storefront catalogue: browsing, search, product pages, reviews.
import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { authenticate } from "../middleware/auth.js";
import { loadProducts } from "../services/catalog.js";

const router = Router();

const SORTS = {
  newest: "p.created_at DESC, p.id DESC",
  price_asc: "min_price ASC NULLS LAST, p.id",
  price_desc: "min_price DESC NULLS LAST, p.id",
  name: "p.name_en ASC",
  featured: "p.is_featured DESC, p.id ASC",
};

router.get("/categories", async (_req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.slug, c.name_en AS name, c.name_fr AS "nameFr",
            (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.is_active) AS "productCount"
       FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.name_en`
  );
  res.json({ data: rows });
});

router.get("/products", async (req, res) => {
  const q = parse(
    z.object({
      search: z.string().trim().max(100).optional(),
      category: z.string().trim().max(80).optional(),
      collection: z.string().trim().max(80).optional(),
      kind: z.enum(["product", "service"]).optional(),
      featured: z.enum(["true", "false"]).optional(),
      inStock: z.enum(["true", "false"]).optional(),
      minPrice: z.coerce.number().int().min(0).optional(),
      maxPrice: z.coerce.number().int().min(0).optional(),
      sort: z.enum(Object.keys(SORTS)).default("featured"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(24),
    }),
    req.query
  );

  const params = [];
  const where = ["p.is_active"];
  if (q.search) {
    const i = params.push(`%${q.search}%`);
    where.push(`(p.name_en ILIKE $${i} OR p.name_fr ILIKE $${i} OR p.collection ILIKE $${i} OR p.description_en ILIKE $${i}
                 OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku ILIKE $${i} OR v.barcode = $${params.push(q.search)})))`);
  }
  if (q.category) where.push(`c.slug = $${params.push(q.category)}`);
  if (q.collection) where.push(`p.collection = $${params.push(q.collection)}`);
  if (q.kind) where.push(`p.kind = $${params.push(q.kind)}`);
  if (q.featured) where.push(`p.is_featured = ${q.featured === "true"}`);
  if (q.inStock === "true") {
    where.push("EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND (NOT v.track_stock OR v.stock_qty > v.reserved_qty))");
  }
  if (q.minPrice !== undefined) where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.price >= $${params.push(q.minPrice)})`);
  if (q.maxPrice !== undefined) where.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.price <= $${params.push(q.maxPrice)})`);

  const { items, total } = await loadProducts(where.join(" AND "), params, {
    orderBy: SORTS[q.sort],
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
  });
  res.json({ data: items, total, page: q.page, limit: q.limit });
});

/**
 * Live availability for the items in a customer's cart / wishlist, polled by the shop so a
 * product that sells out while someone is browsing is shown as unavailable straight away.
 * Exposes only what the product page already shows (never cost or exact reserved quantities).
 */
router.get("/products/availability", async (req, res) => {
  const { variants } = parse(
    z.object({ variants: z.string().regex(/^\d+(,\d+){0,99}$/, "Comma-separated variant ids") }),
    req.query
  );
  const ids = [...new Set(variants.split(",").map(Number))];
  const { rows } = await query(
    `SELECT v.id AS "variantId", v.product_id AS "productId", p.name_en AS name,
            (v.is_active AND p.is_active) AS active, v.track_stock AS "trackStock",
            CASE WHEN v.track_stock THEN greatest(v.stock_qty - v.reserved_qty, 0) END AS available
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1)`,
    [ids]
  );
  const found = new Map(rows.map((r) => [r.variantId, r]));
  res.json({
    data: ids.map((vid) => {
      const r = found.get(vid);
      if (!r) return { variantId: vid, status: "unavailable", available: 0 };
      const status = !r.active ? "unavailable" : r.trackStock && r.available <= 0 ? "sold_out" : "available";
      return { variantId: vid, productId: r.productId, name: r.name, status, available: r.trackStock ? (r.active ? r.available : 0) : null };
    }),
  });
});

router.get("/products/:idOrSlug", async (req, res) => {
  const key = String(req.params.idOrSlug).slice(0, 100);
  const isId = /^\d+$/.test(key);
  const { items } = await loadProducts(`p.is_active AND ${isId ? "p.id = $1" : "p.slug = $1"}`, [isId ? Number(key) : key], { limit: 1 });
  const product = items[0];
  if (!product) throw notFound("Product not found");

  const [reviews, related, alsoBought] = await Promise.all([
    query(
      `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt", split_part(u.full_name, ' ', 1) AS author
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.product_id = $1 AND r.status = 'approved' ORDER BY r.created_at DESC LIMIT 20`,
      [product.id]
    ),
    loadProducts("p.is_active AND p.id <> $1 AND (p.category_id = $2 OR p.collection = $3)", [product.id, product.category?.id ?? 0, product.collection ?? ""], { limit: 8, orderBy: "p.is_featured DESC, random()" }),
    // "customers also bought": products sharing paid orders with this one
    query(
      `SELECT oi2.product_id, count(*) AS n FROM order_items oi1
         JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> oi1.product_id
         JOIN orders o ON o.id = oi1.order_id AND o.paid_at IS NOT NULL
        WHERE oi1.product_id = $1 GROUP BY oi2.product_id ORDER BY n DESC LIMIT 8`,
      [product.id]
    ),
  ]);
  const alsoIds = alsoBought.rows.map((r) => r.product_id);
  const also = alsoIds.length ? (await loadProducts("p.is_active AND p.id = ANY($1)", [alsoIds], { limit: 8 })).items : [];

  res.json({ data: { ...product, reviews: reviews.rows, related: related.items, alsoBought: also } });
});

router.post("/products/:id/reviews", authenticate, async (req, res) => {
  const productId = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }), req.body);
  const product = await query("SELECT id FROM products WHERE id = $1 AND is_active", [productId]);
  if (!product.rowCount) throw notFound("Product not found");

  const { rows } = await query(
    `INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, status = 'pending'
     RETURNING id, status`,
    [productId, req.user.id, body.rating, body.comment ?? null]
  );
  if (!rows[0]) throw badRequest("Could not save review");
  res.status(201).json({ data: rows[0], message: "Thank you! Your review will appear after moderation." });
});

export default router;
