import pg from "pg";
import { config } from "./config.js";

// BIGINT money/ids fit comfortably in a JS number for this shop's scale.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric (lat/lng)

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => console.error("Postgres pool error", err));

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. Rolls back on any thrown error. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
