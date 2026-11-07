import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load server/.env (or the file named by ENV_FILE) without overriding real environment variables.
const envFile = process.env.ENV_FILE || path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  // 127.0.0.1 keeps the API unreachable from the network: only the Vite proxy (development) or
  // nginx (production) on the same machine can reach it. Use 0.0.0.0 only inside a container.
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(14),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  TRUST_PROXY: bool.default("false"),
  UPLOAD_DIR: z.string().default(path.join(root, "uploads")),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),

  // manual  = customers send MoMo / Orange Money to the shop's numbers and upload a screenshot that
  //           admins verify (default). gateway = automatic payment through PAYMENT_PROVIDER.
  ONLINE_PAYMENT_MODE: z.enum(["manual", "gateway"]).default("manual"),
  // Payment screenshots: outside the public uploads folder, served only to staff and the order's owner.
  PROOF_DIR: z.string().default(path.join(root, "private_uploads", "payment-proofs")),
  PAYMENT_PROVIDER: z.enum(["mock", "notchpay"]).default("mock"),
  MOCK_WEBHOOK_SECRET: z.string().default("dev-mock-webhook-secret-change-me"),
  NOTCHPAY_PUBLIC_KEY: z.string().optional(),
  NOTCHPAY_PRIVATE_KEY: z.string().optional(),
  NOTCHPAY_WEBHOOK_HASH: z.string().optional(),
  NOTCHPAY_API_URL: z.string().url().default("https://api.notchpay.co"),
  PAYMENT_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // WhatsApp receipts: "mock" logs messages (development), "cloud" = Meta WhatsApp Cloud API, "off" disables.
  WHATSAPP_PROVIDER: z.enum(["off", "mock", "cloud"]).default("mock"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_URL: z.string().url().default("https://graph.facebook.com/v21.0"),
  WHATSAPP_RECEIPT_TEMPLATE: z.string().default("order_receipt"),
  WHATSAPP_WELCOME_TEMPLATE: z.string().optional(),
  // body: "Hello {{1}}, {{2}}"  (messages and broadcasts sent by admins outside the 24 h reply window)
  WHATSAPP_MESSAGE_TEMPLATE: z.string().default("customer_message"),
  // body: "Hello {{1}}, use this link within 30 minutes to reset your CHAFADIA password: {{2}}"
  WHATSAPP_RESET_TEMPLATE: z.string().default("password_reset"),
  WHATSAPP_TEMPLATE_LANG: z.string().default("en"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("CHAFADIA ENTERPRISE <no-reply@chafadia.local>"),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  RUN_JOBS: bool.default("true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  UPLOAD_DIR: path.resolve(root, parsed.data.UPLOAD_DIR),
  PROOF_DIR: path.resolve(root, parsed.data.PROOF_DIR),
  root,
};

if (config.isProd) {
  if (config.ONLINE_PAYMENT_MODE === "gateway" && config.PAYMENT_PROVIDER === "mock") {
    console.error("PAYMENT_PROVIDER=mock is not allowed in production.");
    process.exit(1);
  }
  if (config.JWT_ACCESS_SECRET.includes("change-me")) {
    console.error("Set a real JWT_ACCESS_SECRET in production.");
    process.exit(1);
  }
}
if (config.WHATSAPP_PROVIDER === "cloud") {
  const missing = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`WHATSAPP_PROVIDER=cloud needs ${missing.join(", ")} in server/.env.`);
    process.exit(1);
  }
}
