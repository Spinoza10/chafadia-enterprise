import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, tv: user.token_version }, config.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: "chafadia-api",
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: "chafadia-api" });
}

/** Constant-time comparison of two strings (e.g. webhook signatures). */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
