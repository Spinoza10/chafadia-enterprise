import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t;
before(async () => {
  t = await setup();
});
after(() => t.teardown());

const refreshCookie = (res) => res.headers["set-cookie"].find((c) => c.startsWith("chf_rt=")).split(";")[0];

describe("auth", () => {
  test("public registration always creates a customer, even if a role is sent", async () => {
    const res = await t.api().post("/api/auth/register").send({ fullName: "Ama", email: "ama@test.cm", password: "Password123", role: "super_admin" });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "customer");
    const { rows } = await t.db.query("SELECT role, password_hash FROM users WHERE email = 'ama@test.cm'");
    assert.equal(rows[0].role, "customer");
    assert.match(rows[0].password_hash, /^\$argon2id\$/, "passwords are hashed with argon2id");
  });

  test("weak passwords and duplicate emails are rejected", async () => {
    const weak = await t.api().post("/api/auth/register").send({ fullName: "Bob", email: "bob@test.cm", password: "short" });
    assert.equal(weak.status, 400);
    const dup = await t.api().post("/api/auth/register").send({ fullName: "Ama", email: "AMA@test.cm", password: "Password123" });
    assert.equal(dup.status, 400);
  });

  test("login returns an access token and an httpOnly SameSite=Strict refresh cookie", async () => {
    const res = await t.api().post("/api/auth/login").send({ email: "ama@test.cm", password: "Password123" });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    const cookie = res.headers["set-cookie"].find((c) => c.startsWith("chf_rt="));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(res.body.user.password_hash, undefined);
  });

  test("same error for unknown email and wrong password", async () => {
    const a = await t.api().post("/api/auth/login").send({ email: "nobody@test.cm", password: "Password123" });
    const b = await t.api().post("/api/auth/login").send({ email: "ama@test.cm", password: "WrongPass123" });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test("account locks after 5 failed attempts, even with the right password", async () => {
    await t.createUser({ email: "lock@test.cm" });
    for (let i = 0; i < 5; i++) await t.api().post("/api/auth/login").send({ email: "lock@test.cm", password: "WrongPass123" });
    const res = await t.api().post("/api/auth/login").send({ email: "lock@test.cm", password: "Password123" });
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /Too many failed attempts/);
    const { rows } = await t.db.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.lockout'");
    assert.equal(rows[0].n, 1);
  });

  test("refresh requires the CSRF header", async () => {
    const login = await t.api().post("/api/auth/login").send({ email: "ama@test.cm", password: "Password123" });
    const res = await t.rawApi().post("/api/auth/refresh").set("Cookie", refreshCookie(login));
    assert.equal(res.status, 403);
  });

  test("refresh rotates the token; replaying an old token revokes the whole session", async () => {
    const login = await t.api().post("/api/auth/login").send({ email: "ama@test.cm", password: "Password123" });
    const first = refreshCookie(login);
    const r1 = await t.api().post("/api/auth/refresh").set("Cookie", first).set("X-Requested-With", "chafadia");
    assert.equal(r1.status, 200);
    const second = refreshCookie(r1);
    assert.notEqual(first, second);

    const replay = await t.api().post("/api/auth/refresh").set("Cookie", first).set("X-Requested-With", "chafadia");
    assert.equal(replay.status, 401);
    // the legitimately rotated token is now dead too (theft response)
    const r2 = await t.api().post("/api/auth/refresh").set("Cookie", second).set("X-Requested-With", "chafadia");
    assert.equal(r2.status, 401);
  });

  test("forged or tampered access tokens are rejected", async () => {
    const login = await t.login("ama@test.cm");
    const [h, , s] = login.token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "1", role: "super_admin", tv: 0, iss: "chafadia-api" })).toString("base64url");
    const res = await t.api().get("/api/auth/me").set("Authorization", `Bearer ${h}.${forgedPayload}.${s}`);
    assert.equal(res.status, 401);
  });

  test("forgot password gives the same answer for unknown emails and resets work once", async () => {
    const { sentMail } = await import("../src/lib/mailer.js");
    const unknown = await t.api().post("/api/auth/forgot-password").send({ email: "ghost@test.cm" });
    const known = await t.api().post("/api/auth/forgot-password").send({ email: "ama@test.cm" });
    assert.equal(unknown.body.message, known.body.message);
    await new Promise((r) => setTimeout(r, 50));
    const mail = sentMail.find((m) => m.to === "ama@test.cm");
    const token = mail.text.match(/token=([\w-]+)/)[1];

    const reset = await t.api().post("/api/auth/reset-password").send({ token, password: "NewPassword456" });
    assert.equal(reset.status, 200);
    const again = await t.api().post("/api/auth/reset-password").send({ token, password: "Another789xyz" });
    assert.equal(again.status, 400);
    const ok = await t.api().post("/api/auth/login").send({ email: "ama@test.cm", password: "NewPassword456" });
    assert.equal(ok.status, 200);
  });
});
