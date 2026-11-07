// Staff catalogue management: products, services, variants, prices, cost prices, stock, images.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { checkBackInStock, checkLowStock } from "../lib/notify.js";
import { can } from "../lib/rbac.js";
import { id, money, pagination, parse } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { loadProducts, shapeVariant, slugify } from "../services/catalog.js";

const router = Router();
router.use(authenticate);

const staffView = (req) => ({ staff: true, showCost: can(req.user, "products.view_cost") });

const variantInput = z.object({
  sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, "SKU may contain letters, digits, . _ -").optional(),
  barcode: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(80).default("Standard"),
  attributes: z.record(z.string(), z.string()).default({}),
  price: money,
  compareAtPrice: money.nullable().optional(),
  costPrice: money.default(0),
  trackStock: z.boolean().default(true),
  initialStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000).default(5),
});

const productInput = z.object({
  kind: z.enum(["product", "service"]).default("product"),
  name: z.string().trim().min(2).max(160),
  nameFr: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(5000).default(""),
  descriptionFr: z.string().trim().max(5000).nullable().optional(),
  categoryId: id.nullable().optional(),
  categoryName: z.string().trim().min(2).max(80).optional(), // creates the category if new
  collection: z.string().trim().max(80).nullable().optional(),
  badge: z.string().trim().max(40).nullable().optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  featured: z.boolean().default(false),
  durationMinutes: z.coerce.number().int().positive().max(24 * 60).nullable().optional(),
  requiresBooking: z.boolean().default(false),
  variants: z.array(variantInput).min(1).max(50),
});

async function resolveCategory(client, body) {
  if (body.categoryId) return body.categoryId;
  if (!body.categoryName) return null;
  const slug = slugify(body.categoryName);
  const { rows } = await client.query(
    `INSERT INTO categories (slug, name_en) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [slug, body.categoryName]
  );
  return rows[0].id;
}

async function uniqueSlug(client, base) {
  const slug = slugify(base);
  const { rows } = await client.query("SELECT slug FROM products WHERE slug = $1 OR slug LIKE $2", [slug, `${slug}-%`]);
  if (!rows.length) return slug;
  return `${slug}-${crypto.randomBytes(3).toString("hex")}`;
}

async function insertVariant(client, req, productId, v, kind) {
  const trackStock = kind === "service" ? false : v.trackStock;
  const sku = (v.sku || `CHF-${productId}-${crypto.randomBytes(2).toString("hex")}`).toUpperCase();
  const stock = trackStock ? v.initialStock : 0;
  const { rows } = await client.query(
    `INSERT INTO product_variants (product_id, sku, barcode, name, attributes, price, compare_at_price, cost_price,
                                   track_stock, stock_qty, low_stock_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [productId, sku, v.barcode || null, v.name, JSON.stringify(v.attributes), v.price, v.compareAtPrice ?? null,
      v.costPrice, trackStock, stock, v.lowStockThreshold]
  );
  if (stock > 0) {
    await client.query(
      `INSERT INTO stock_movements (variant_id, type, quantity, stock_before, stock_after, reference_type, note, created_by)
       VALUES ($1, 'purchase', $2, 0, $2, 'initial', 'Initial stock', $3)`,
      [rows[0].id, stock, req.user.id]
    );
  }
  return rows[0];
}

function rethrowUnique(err) {
  if (err.code === "23505") throw badRequest(`Duplicate value: ${err.detail ?? "SKU or barcode already exists"}`);
  throw err;
}

// ---------------------------------------------------------------- products
router.get("/products", requirePermission("products.manage", "stock.adjust", "pos.sell", "orders.view"), async (req, res) => {
  const q = parse(
    pagination.extend({
      search: z.string().trim().max(100).optional(),
      status: z.enum(["all", "active", "inactive", "low", "out"]).default("all"),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    req.query
  );
  const params = [];
  const where = ["true"];
  if (q.search) {
    const i = params.push(`%${q.search}%`);
    where.push(`(p.name_en ILIKE $${i} OR p.collection ILIKE $${i} OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku ILIKE $${i} OR v.barcode ILIKE $${i})))`);
  }
  if (q.status === "active") where.push("p.is_active");
  if (q.status === "inactive") where.push("NOT p.is_active");
  if (q.status === "low") where.push("EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.track_stock AND v.stock_qty - v.reserved_qty BETWEEN 1 AND v.low_stock_threshold)");
  if (q.status === "out") where.push("EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.track_stock AND v.stock_qty - v.reserved_qty <= 0)");

  const { items, total } = await loadProducts(where.join(" AND "), params, {
    orderBy: "p.created_at DESC, p.id DESC",
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
    ...staffView(req),
  });
  res.json({ data: items, total, page: q.page, limit: q.limit });
});

router.post("/products", requirePermission("products.manage"), async (req, res) => {
  const body = parse(productInput, req.body);
  const productId = await tx(async (client) => {
    const categoryId = await resolveCategory(client, body);
    const { rows } = await client.query(
      `INSERT INTO products (slug, kind, category_id, collection, name_en, name_fr, description_en, description_fr, badge,
                             option_labels, is_featured, duration_minutes, requires_booking, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [await uniqueSlug(client, body.name), body.kind, categoryId, body.collection ?? null, body.name, body.nameFr ?? null,
        body.description, body.descriptionFr ?? null, body.badge ?? null, JSON.stringify(body.options), body.featured,
        body.durationMinutes ?? null, body.requiresBooking, req.user.id]
    );
    const pid = rows[0].id;
    for (const v of body.variants) await insertVariant(client, req, pid, v, body.kind).catch(rethrowUnique);
    await audit({ req, client, action: "product.create", entityType: "product", entityId: pid, newValue: body });
    return pid;
  });
  const { items } = await loadProducts("p.id = $1", [productId], staffView(req));
  res.status(201).json({ data: items[0] });
});

router.patch("/products/:id", requirePermission("products.manage"), async (req, res) => {
  const productId = parse(id, req.params.id);
  const body = parse(productInput.omit({ variants: true }).partial().extend({ isActive: z.boolean().optional() }), req.body);

  await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM products WHERE id = $1 FOR UPDATE", [productId]);
    if (!rows[0]) throw notFound("Product not found");
    const categoryId = body.categoryId !== undefined || body.categoryName ? await resolveCategory(client, body) : undefined;
    const next = {
      kind: body.kind, name_en: body.name, name_fr: body.nameFr, description_en: body.description,
      description_fr: body.descriptionFr, category_id: categoryId, collection: body.collection, badge: body.badge,
      option_labels: body.options, is_featured: body.featured, is_active: body.isActive,
      duration_minutes: body.durationMinutes, requires_booking: body.requiresBooking,
    };
    const { oldValue, newValue, changed } = diff(rows[0], next);
    if (!changed) return;
    const cols = Object.keys(newValue);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    const values = cols.map((c) => (c === "option_labels" ? JSON.stringify(newValue[c]) : newValue[c]));
    await client.query(`UPDATE products SET ${sets.join(", ")} WHERE id = $1`, [productId, ...values]);
    await audit({ req, client, action: newValue.is_active === false ? "product.deactivate" : "product.update", entityType: "product", entityId: productId, oldValue, newValue });
  });
  const { items } = await loadProducts("p.id = $1", [productId], staffView(req));
  res.json({ data: items[0] });
});

// Products with sales history are never hard-deleted; they are deactivated (hidden from the shop).
router.delete("/products/:id", requirePermission("products.manage"), async (req, res) => {
  const productId = parse(id, req.params.id);
  await tx(async (client) => {
    const { rows } = await client.query("UPDATE products SET is_active = false WHERE id = $1 RETURNING id, name_en", [productId]);
    if (!rows[0]) throw notFound("Product not found");
    await audit({ req, client, action: "product.deactivate", entityType: "product", entityId: productId, oldValue: { is_active: true }, newValue: { is_active: false } });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------- variants
router.post("/products/:id/variants", requirePermission("products.manage"), async (req, res) => {
  const productId = parse(id, req.params.id);
  const body = parse(variantInput, req.body);
  const variant = await tx(async (client) => {
    const { rows } = await client.query("SELECT kind FROM products WHERE id = $1", [productId]);
    if (!rows[0]) throw notFound("Product not found");
    const v = await insertVariant(client, req, productId, body, rows[0].kind).catch(rethrowUnique);
    await audit({ req, client, action: "variant.create", entityType: "variant", entityId: v.id, newValue: body });
    return v;
  });
  res.status(201).json({ data: shapeVariant(variant, staffView(req)) });
});

router.patch("/variants/:id", requirePermission("products.manage"), async (req, res) => {
  const variantId = parse(id, req.params.id);
  const body = parse(
    variantInput.omit({ initialStock: true, trackStock: true }).partial().extend({ isActive: z.boolean().optional() }),
    req.body
  );
  const variant = await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM product_variants WHERE id = $1 FOR UPDATE", [variantId]);
    if (!rows[0]) throw notFound("Variant not found");
    const next = {
      sku: body.sku?.toUpperCase(), barcode: body.barcode, name: body.name, attributes: body.attributes,
      price: body.price, compare_at_price: body.compareAtPrice, cost_price: body.costPrice,
      low_stock_threshold: body.lowStockThreshold, is_active: body.isActive,
    };
    const { oldValue, newValue, changed } = diff(rows[0], next);
    if (!changed) return rows[0];
    const cols = Object.keys(newValue);
    const values = cols.map((c) => (c === "attributes" ? JSON.stringify(newValue[c]) : newValue[c]));
    const updated = await client
      .query(`UPDATE product_variants SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [variantId, ...values])
      .catch(rethrowUnique);
    const action = "price" in newValue || "cost_price" in newValue ? "variant.price_change" : "variant.update";
    await audit({ req, client, action, entityType: "variant", entityId: variantId, oldValue, newValue });
    return updated.rows[0];
  });
  res.json({ data: shapeVariant(variant, staffView(req)) });
});

/** Record a purchase (stock in) or an adjustment (+/-). Sales and returns are recorded by the order flow. */
router.post("/variants/:id/stock", requirePermission("stock.adjust"), async (req, res) => {
  const variantId = parse(id, req.params.id);
  const body = parse(
    z.object({
      type: z.enum(["purchase", "adjustment"]),
      quantity: z.coerce.number().int().refine((n) => n !== 0, "Quantity cannot be 0").refine((n) => Math.abs(n) <= 1_000_000),
      note: z.string().trim().min(2, "Give a reason").max(500),
      costPrice: money.optional(), // purchases may update the cost price
    }),
    req.body
  );
  if (body.type === "purchase" && body.quantity < 0) throw badRequest("A purchase must add stock; use an adjustment to remove");

  const variant = await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM product_variants WHERE id = $1 FOR UPDATE", [variantId]);
    const v = rows[0];
    if (!v) throw notFound("Variant not found");
    if (!v.track_stock) throw badRequest("This item does not track stock (service)");
    const after = v.stock_qty + body.quantity;
    if (after < v.reserved_qty) {
      throw badRequest(`Stock cannot go below ${v.reserved_qty} (units reserved by pending orders)`);
    }
    const updated = await client.query(
      "UPDATE product_variants SET stock_qty = $2, cost_price = COALESCE($3, cost_price) WHERE id = $1 RETURNING *",
      [variantId, after, body.costPrice ?? null]
    );
    await client.query(
      `INSERT INTO stock_movements (variant_id, type, quantity, stock_before, stock_after, reference_type, note, created_by)
       VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7)`,
      [variantId, body.type, body.quantity, v.stock_qty, after, body.note, req.user.id]
    );
    await audit({
      req, client, action: "stock.change", entityType: "variant", entityId: variantId,
      oldValue: { stock_qty: v.stock_qty, cost_price: v.cost_price },
      newValue: { stock_qty: after, type: body.type, note: body.note, ...(body.costPrice !== undefined && { cost_price: body.costPrice }) },
    });
    await checkLowStock(client, variantId, v.stock_qty - v.reserved_qty);
    await checkBackInStock(client, variantId, v.stock_qty - v.reserved_qty);
    return updated.rows[0];
  });
  res.json({ data: shapeVariant(variant, staffView(req)) });
});

router.get("/stock-movements", requirePermission("stock.adjust", "products.manage"), async (req, res) => {
  const q = parse(pagination.extend({ variantId: id.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  const params = [];
  const where = q.variantId ? `WHERE m.variant_id = $${params.push(q.variantId)}` : "";
  const { rows } = await query(
    `SELECT m.id, m.type, m.quantity, m.stock_before AS "stockBefore", m.stock_after AS "stockAfter",
            m.reference_type AS "referenceType", m.reference_id AS "referenceId", m.note, m.created_at AS "createdAt",
            v.sku, p.name_en AS "productName", u.full_name AS "createdBy", count(*) OVER() AS total
       FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
       LEFT JOIN users u ON u.id = m.created_by
       ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 });
});

// ---------------------------------------------------------------- images
fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
const IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOAD_DIR,
    // random name: the client never controls the path or extension on disk
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
});

/** Check the file's magic bytes so a renamed non-image is rejected. */
function looksLikeImage(filePath) {
  const b = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  return jpeg || png || webp;
}

router.post("/products/:id/images", requirePermission("products.manage"), upload.array("images", 6), async (req, res) => {
  const productId = parse(id, req.params.id);
  const files = req.files ?? [];
  const valid = files.filter((f) => looksLikeImage(f.path));
  for (const f of files) if (!valid.includes(f)) fs.rmSync(f.path, { force: true });
  if (!valid.length) throw badRequest("Upload JPEG, PNG or WebP images (max " + config.MAX_UPLOAD_MB + " MB each)");

  const exists = await query("SELECT 1 FROM products WHERE id = $1", [productId]);
  if (!exists.rowCount) {
    for (const f of valid) fs.rmSync(f.path, { force: true });
    throw notFound("Product not found");
  }
  const urls = valid.map((f) => `/uploads/${path.basename(f.path)}`);
  for (const [i, url] of urls.entries()) {
    await query("INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, (SELECT coalesce(max(sort_order), 0) + 1 + $3 FROM product_images WHERE product_id = $1))", [productId, url, i]);
  }
  await audit({ req, action: "product.images_add", entityType: "product", entityId: productId, newValue: urls });
  res.status(201).json({ data: urls });
});

router.delete("/products/:id/images", requirePermission("products.manage"), async (req, res) => {
  const productId = parse(id, req.params.id);
  const { url } = parse(z.object({ url: z.string().max(300) }), req.body);
  const { rowCount } = await query("DELETE FROM product_images WHERE product_id = $1 AND url = $2", [productId, url]);
  if (!rowCount) throw notFound("Image not found");
  if (url.startsWith("/uploads/")) fs.rmSync(path.join(config.UPLOAD_DIR, path.basename(url)), { force: true });
  await audit({ req, action: "product.image_remove", entityType: "product", entityId: productId, oldValue: url });
  res.status(204).end();
});

export default router;
