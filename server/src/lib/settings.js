import { query } from "../db.js";

export async function getSetting(key, fallback, run = query) {
  const { rows } = await run("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function getShop(run = query) {
  return getSetting("shop", { name: "CHAFADIA ENTERPRISE" }, run);
}
