// Import the original storefront catalogue (seed/catalog.json) into the database.
// Safe to re-run: products that already exist (by slug) are skipped.
// Images are stored as "asset:<file>" and resolved by the frontend to its bundled images.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../src/config.js";
import { pool, tx } from "../src/db.js";
import { slugify } from "../src/services/catalog.js";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../seed/catalog.json");
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));

export async function seedCatalog({ log = console.log } = {}) {
  let created = 0;
  await tx(async (client) => {
    const categoryIds = new Map();
    let order = 0;
    for (const name of [...new Set(catalog.map((p) => p.category))]) {
      const { rows } = await client.query(
        `INSERT INTO categories (slug, name_en, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
        [slugify(name), name, order++]
      );
      categoryIds.set(name, rows[0].id);
    }

    for (const p of catalog) {
      const exists = await client.query("SELECT 1 FROM products WHERE slug = $1", [p.slug]);
      if (exists.rowCount) continue;
      const { rows } = await client.query(
        `INSERT INTO products (slug, kind, category_id, collection, name_en, description_en, badge, option_labels, is_featured)
         VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [p.slug, categoryIds.get(p.category), p.collection || null, p.name, p.description || "", p.badge || null,
          JSON.stringify((p.options || []).filter((o) => o !== "Standard")), Boolean(p.featured)]
      );
      const productId = rows[0].id;
      const discount = Number(p.discount) || 0;
      const price = discount > 0 ? Math.round(p.price * (1 - discount / 100)) : p.price;
      // SKUs derived from the unique slug (the old generator produced duplicates).
      const sku = `CHF-${p.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
      const { rows: v } = await client.query(
        `INSERT INTO product_variants (product_id, sku, name, price, compare_at_price, cost_price, stock_qty)
         VALUES ($1, $2, 'Standard', $3, $4, 0, $5) RETURNING id`,
        [productId, sku, price, discount > 0 ? p.price : null, p.stock]
      );
      if (p.stock > 0) {
        await client.query(
          `INSERT INTO stock_movements (variant_id, type, quantity, stock_before, stock_after, reference_type, note)
           VALUES ($1, 'purchase', $2, 0, $2, 'seed', 'Opening stock (imported catalogue)')`,
          [v[0].id, p.stock]
        );
      }
      for (const [i, img] of (p.images || []).entries()) {
        await client.query("INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3)", [productId, img, i]);
      }
      created += 1;
    }
  });
  log(`Catalogue seeded: ${created} new products (${catalog.length} in seed file).`);
  if (created) log("Note: cost prices are 0 - enter real cost prices in Admin > Products so profit reports are correct.");
  return created;
}

if (process.argv[1]?.endsWith("seed-catalog.js")) {
  seedCatalog()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
