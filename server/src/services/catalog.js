import { query } from "../db.js";

/** Load products with their variants, images and review stats, shaped for the API. */
export async function loadProducts(where, params, { orderBy = "p.created_at DESC", limit = 50, offset = 0, staff = false, showCost = false } = {}) {
  const { rows } = await query(
    `SELECT p.*, c.slug AS category_slug, c.name_en AS category_name, c.name_fr AS category_name_fr,
            count(*) OVER() AS total_count,
            (SELECT min(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.is_active) AS min_price,
            (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating,
            (SELECT count(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS review_count
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    params
  );
  if (!rows.length) return { items: [], total: 0 };

  const ids = rows.map((r) => r.id);
  const [variants, images] = await Promise.all([
    query(`SELECT * FROM product_variants WHERE product_id = ANY($1) ${staff ? "" : "AND is_active"} ORDER BY price, id`, [ids]),
    query("SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order, id", [ids]),
  ]);

  const items = rows.map((p) => shapeProduct(p, {
    variants: variants.rows.filter((v) => v.product_id === p.id),
    images: images.rows.filter((i) => i.product_id === p.id),
    staff,
    showCost,
  }));
  return { items, total: rows[0].total_count };
}

export function shapeVariant(v, { staff = false, showCost = false } = {}) {
  const available = v.track_stock ? Math.max(0, v.stock_qty - v.reserved_qty) : null;
  const out = {
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    name: v.name,
    attributes: v.attributes,
    price: v.price,
    compareAtPrice: v.compare_at_price,
    trackStock: v.track_stock,
    available,
    inStock: !v.track_stock || available > 0,
    lowStock: v.track_stock && available > 0 && available <= v.low_stock_threshold,
  };
  if (staff) {
    Object.assign(out, {
      stockQty: v.stock_qty,
      reservedQty: v.reserved_qty,
      lowStockThreshold: v.low_stock_threshold,
      isActive: v.is_active,
    });
  }
  if (showCost) out.costPrice = v.cost_price;
  return out;
}

function shapeProduct(p, { variants, images, staff, showCost }) {
  const shapedVariants = variants.map((v) => shapeVariant(v, { staff, showCost }));
  return {
    id: p.id,
    slug: p.slug,
    kind: p.kind,
    name: p.name_en,
    nameFr: p.name_fr,
    description: p.description_en,
    descriptionFr: p.description_fr,
    category: p.category_id ? { id: p.category_id, slug: p.category_slug, name: p.category_name, nameFr: p.category_name_fr } : null,
    collection: p.collection,
    badge: p.badge,
    options: p.option_labels,
    featured: p.is_featured,
    isActive: p.is_active,
    durationMinutes: p.duration_minutes,
    requiresBooking: p.requires_booking,
    price: p.min_price ?? shapedVariants[0]?.price ?? 0,
    images: images.map((i) => i.url),
    variants: shapedVariants,
    inStock: shapedVariants.some((v) => v.inStock),
    available: shapedVariants.every((v) => v.available === null) ? null : shapedVariants.reduce((s, v) => s + (v.available ?? 0), 0),
    rating: p.rating,
    reviewCount: p.review_count,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export const slugify = (text) =>
  String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
