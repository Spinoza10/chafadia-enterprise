// Test harness: builds a fresh database for each test file, migrated and granted exactly like
// production (tests run as the least-privilege runtime role), then loads the app.
//
// Requires TEST_DATABASE_ADMIN_URL: a superuser connection to a disposable Postgres server,
// e.g. postgresql://postgres:password@localhost:5432/postgres
import pg from "pg";
import request from "supertest";
import { applyGrants, runMigrations } from "../scripts/lib/migrator.js";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
if (!ADMIN_URL) {
  console.error("Set TEST_DATABASE_ADMIN_URL to a superuser connection string to run the tests.");
  process.exit(1);
}
const DB = "chafadia_test";
const APP_ROLE = "chafadia_test_app";
const APP_PASS = "test_app_password";

async function resetDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (!role.rowCount) await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASS}'`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB}`;
  const owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  await runMigrations(owner, () => {});
  await applyGrants(owner, APP_ROLE);
  await owner.end();

  const appUrl = new URL(url.toString());
  appUrl.username = APP_ROLE;
  appUrl.password = APP_PASS;
  return appUrl.toString();
}

export async function setup({ env = {} } = {}) {
  const databaseUrl = await resetDatabase();
  Object.assign(process.env, {
    ONLINE_PAYMENT_MODE: "gateway",
    PROOF_DIR: "./private_uploads/test-proofs",
    ENV_FILE: "__none__",
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
    PAYMENT_PROVIDER: "mock",
    RUN_JOBS: "false",
    LOGIN_MAX_ATTEMPTS: "5",
    ...env,
  });
  const { createApp } = await import("../src/app.js");
  const db = await import("../src/db.js");
  const argon2 = (await import("argon2")).default;
  const app = createApp();
  // Every request carries the header the web app sends (the API refuses calls without it).
  const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
  const api = () => {
    const agent = request(app);
    return new Proxy(agent, {
      get: (target, prop) =>
        METHODS.has(prop) ? (...args) => target[prop](...args).set("X-Requested-With", "chafadia") : Reflect.get(target, prop),
    });
  };
  /** Raw client without the app header (for testing the API guard and provider webhooks). */
  const rawApi = () => request(app);

  async function createUser({ role = "customer", email, password = "Password123", name = "Test User" }) {
    const hash = await argon2.hash(password);
    const { rows } = await db.query(
      "INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
      [email, name, hash, role]
    );
    return rows[0];
  }

  async function login(email, password = "Password123") {
    const res = await api().post("/api/auth/login").send({ email, password });
    if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.accessToken, user: res.body.user, cookie: res.headers["set-cookie"] };
  }

  /** Users for every role, logged in. */
  async function seedRoles() {
    await createUser({ role: "super_admin", email: "owner@test.cm", name: "Owner" });
    await createUser({ role: "admin", email: "admin@test.cm", name: "Admin" });
    await createUser({ role: "cashier", email: "cashier@test.cm", name: "Cashier One" });
    await createUser({ role: "cashier", email: "cashier2@test.cm", name: "Cashier Two" });
    await createUser({ role: "delivery", email: "rider@test.cm", name: "Rider" });
    await createUser({ role: "customer", email: "customer@test.cm", name: "Customer" });
    const entries = await Promise.all(
      ["owner", "admin", "cashier", "cashier2", "rider", "customer"].map(async (k) => [k, await login(`${k}@test.cm`)])
    );
    return Object.fromEntries(entries);
  }

  /** A product with one stock-tracked variant. */
  async function createProduct(ownerToken, { name = "Test Juice", price = 1500, cost = 900, stock = 10, threshold = 2 } = {}) {
    const res = await api()
      .post("/api/admin/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name, categoryName: "Drinks", variants: [{ price, costPrice: cost, initialStock: stock, lowStockThreshold: threshold }] });
    if (res.status !== 201) throw new Error(`createProduct failed: ${JSON.stringify(res.body)}`);
    return { product: res.body.data, variantId: res.body.data.variants[0].id };
  }

  async function stockOf(variantId) {
    const { rows } = await db.query("SELECT stock_qty, reserved_qty FROM product_variants WHERE id = $1", [variantId]);
    return rows[0];
  }

  async function teardown() {
    await db.pool.end();
  }

  return { app, api, rawApi, db, createUser, login, seedRoles, createProduct, stockOf, teardown };
}

export const bearer = (session) => ({ Authorization: `Bearer ${session.token}` });

export const checkoutBody = (variantId, quantity = 1, extra = {}) => ({
  items: [{ variantId, quantity }],
  customer: { name: "Guest Buyer", phone: "+237650000000", email: "guest@test.cm" },
  fulfilment: "pickup",
  paymentMethod: "mtn_momo",
  ...extra,
});
