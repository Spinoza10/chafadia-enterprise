import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, setup } from "./helpers.js";

let t;
let s; // sessions per role
let variantId;
before(async () => {
  t = await setup();
  s = await t.seedRoles();
  ({ variantId } = await t.createProduct(s.owner.token));
});
after(() => t.teardown());

const get = (path, session) => t.api().get(path).set(bearer(session));
const post = (path, session, body = {}) => t.api().post(path).set(bearer(session)).send(body);

describe("staff management is Super Admin only", () => {
  test("Super Admin creates an admin and a cashier", async () => {
    const a = await post("/api/users", s.owner, { fullName: "New Admin", email: "newadmin@test.cm", role: "admin", password: "Password123" });
    assert.equal(a.status, 201);
    const c = await post("/api/users", s.owner, { fullName: "New Cashier", email: "newcashier@test.cm", role: "cashier", password: "Password123" });
    assert.equal(c.status, 201);
  });

  test("nobody can create another Super Admin through the API", async () => {
    const res = await post("/api/users", s.owner, { fullName: "Evil", email: "evil@test.cm", role: "super_admin", password: "Password123" });
    assert.equal(res.status, 400);
  });

  for (const role of ["admin", "cashier", "rider", "customer"]) {
    test(`${role} cannot list, create or edit staff`, async () => {
      assert.equal((await get("/api/users", s[role])).status, 403);
      const res = await post("/api/users", s[role], { fullName: "X", email: `x-${role}@test.cm`, role: "admin", password: "Password123" });
      assert.equal(res.status, 403);
    });
  }

  test("suspending a user kills their existing session immediately", async () => {
    const victim = await t.createUser({ role: "cashier", email: "suspend@test.cm" });
    const session = await t.login("suspend@test.cm");
    assert.equal((await get("/api/auth/me", session)).status, 200);
    const res = await t.api().patch(`/api/users/${victim.id}`).set(bearer(s.owner)).send({ status: "suspended" });
    assert.equal(res.status, 200);
    assert.equal((await get("/api/auth/me", session)).status, 401);
    const relog = await t.api().post("/api/auth/login").send({ email: "suspend@test.cm", password: "Password123" });
    assert.equal(relog.status, 403);
  });

  test("the Super Admin account cannot be edited or deleted via the API", async () => {
    const { rows } = await t.db.query("SELECT id FROM users WHERE role = 'super_admin'");
    const del = await t.api().delete(`/api/users/${rows[0].id}`).set(bearer(s.owner));
    assert.equal(del.status, 403);
  });
});

describe("permission matrix", () => {
  test("granting pos.discount to a cashier takes effect; Super-Admin-only permissions cannot be granted", async () => {
    const { rows } = await t.db.query("SELECT id FROM users WHERE email = 'cashier@test.cm'");
    const cashierId = rows[0].id;
    const bad = await t.api().put(`/api/users/${cashierId}/permissions`).set(bearer(s.owner)).send({ overrides: { "users.manage": true } });
    assert.equal(bad.status, 400);
    const good = await t.api().put(`/api/users/${cashierId}/permissions`).set(bearer(s.owner)).send({ overrides: { "pos.discount": true } });
    assert.equal(good.status, 200);
    assert.ok(good.body.effective.includes("pos.discount"));
    const me = await get("/api/auth/me", s.cashier);
    assert.ok(me.body.user.permissions.includes("pos.discount"));
  });

  test("revoking a role default removes it", async () => {
    const { rows } = await t.db.query("SELECT id FROM users WHERE email = 'cashier2@test.cm'");
    await t.api().put(`/api/users/${rows[0].id}/permissions`).set(bearer(s.owner)).send({ overrides: { "pos.sell": false } });
    assert.equal((await get("/api/pos/shifts/current", s.cashier2)).status, 403);
  });
});

describe("Admin is limited exactly as specified", () => {
  test("admin CAN add products, change prices and stock, view orders, print receipts, see totals and slow products", async () => {
    const p = await post("/api/admin/products", s.admin, { name: "Admin Product", variants: [{ price: 2000, costPrice: 1000, initialStock: 5 }] });
    assert.equal(p.status, 201);
    assert.equal(p.body.data.variants[0].costPrice, 1000, "admin sees cost price");
    const price = await t.api().patch(`/api/admin/variants/${variantId}`).set(bearer(s.admin)).send({ price: 1600 });
    assert.equal(price.status, 200);
    const stock = await post(`/api/admin/variants/${variantId}/stock`, s.admin, { type: "purchase", quantity: 5, note: "Supplier delivery" });
    assert.equal(stock.status, 200);
    assert.equal((await get("/api/orders", s.admin)).status, 200);
    assert.equal((await get("/api/receipts", s.admin)).status, 200);
    const dash = await get("/api/reports/admin", s.admin);
    assert.equal(dash.status, 200);
    assert.ok("totalSold" in dash.body.data && "slowProducts" in dash.body.data && "stuckOrders" in dash.body.data);
  });

  test("admin CANNOT manage settings, refunds, full reports, audit log, payments list or coupons", async () => {
    assert.equal((await t.api().put("/api/settings/tax_rate_percent").set(bearer(s.admin)).send({ value: 5 })).status, 403);
    assert.equal((await post("/api/orders/1/refunds", s.admin, { reason: "test" })).status, 403);
    assert.equal((await get("/api/reports/summary", s.admin)).status, 403);
    assert.equal((await get("/api/audit-logs", s.admin)).status, 403);
    assert.equal((await get("/api/payments", s.admin)).status, 403);
    assert.equal((await get("/api/coupons", s.admin)).status, 403);
  });

  test("admin's product report has no profit column; Super Admin's does", async () => {
    const a = await get("/api/reports/products", s.admin);
    assert.equal(a.status, 200);
    assert.equal(a.body.data[0].profit, undefined);
    const o = await get("/api/reports/products", s.owner);
    assert.ok("profit" in o.body.data[0]);
  });
});

describe("cashier, delivery and customer boundaries", () => {
  test("cashier cannot manage products or stock and does not see cost prices", async () => {
    assert.equal((await post("/api/admin/products", s.cashier, { name: "Nope", variants: [{ price: 1 }] })).status, 403);
    assert.equal((await post(`/api/admin/variants/${variantId}/stock`, s.cashier, { type: "purchase", quantity: 1, note: "xx" })).status, 403);
    const list = await get("/api/admin/products", s.cashier);
    assert.equal(list.status, 200);
    assert.equal(list.body.data[0].variants[0].costPrice, undefined);
  });

  test("the public catalogue never exposes cost prices", async () => {
    const res = await t.api().get("/api/products");
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
    assert.equal(JSON.stringify(res.body).includes("cost"), false);
  });

  test("customer and delivery person cannot reach staff endpoints", async () => {
    for (const path of ["/api/admin/products", "/api/reports/admin", "/api/receipts", "/api/admin/stock-movements"]) {
      assert.equal((await get(path, s.customer)).status, 403, path);
    }
    assert.equal((await get("/api/reports/admin", s.rider)).status, 403);
  });

  test("unauthenticated requests to protected endpoints get 401", async () => {
    for (const path of ["/api/users", "/api/admin/products", "/api/orders", "/api/reports/summary", "/api/audit-logs", "/api/pos/summary"]) {
      assert.equal((await t.api().get(path)).status, 401, path);
    }
  });
});

describe("audit log", () => {
  test("price change, stock change and role change are recorded with old and new values", async () => {
    const { rows } = await t.db.query("SELECT action, old_value, new_value, actor_role FROM audit_logs ORDER BY id");
    const price = rows.find((r) => r.action === "variant.price_change");
    assert.equal(price.old_value.price, 1500);
    assert.equal(price.new_value.price, 1600);
    assert.equal(price.actor_role, "admin");
    const stock = rows.find((r) => r.action === "stock.change");
    assert.equal(stock.old_value.stock_qty, 10);
    assert.equal(stock.new_value.stock_qty, 15);
    assert.ok(rows.some((r) => r.action === "user.suspend"));
    assert.ok(rows.some((r) => r.action === "user.permissions_change"));
  });

  test("the application's database role cannot modify or delete audit entries", async () => {
    await assert.rejects(t.db.query("UPDATE audit_logs SET action = 'tampered'"), /permission denied/);
    await assert.rejects(t.db.query("DELETE FROM audit_logs"), /permission denied/);
  });

  test("only the Super Admin can read it", async () => {
    const res = await get("/api/audit-logs", s.owner);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0);
  });
});
