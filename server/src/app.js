import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { query } from "./db.js";
import { HttpError } from "./lib/errors.js";
import adminRoutes from "./routes/admin.js";
import adminCatalogRoutes from "./routes/adminCatalog.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payments.js";
import paymentProofRoutes from "./routes/paymentProofs.js";
import posRoutes from "./routes/pos.js";
import receiptRoutes from "./routes/receipts.js";
import reportRoutes from "./routes/reports.js";
import userRoutes from "./routes/users.js";
import whatsappRoutes from "./routes/whatsapp.js";
import customerRoutes from "./routes/customers.js";

const isWebhook = (path) => path.startsWith("/api/payments/webhook") || path.startsWith("/api/whatsapp/webhook");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: config.isProd,
    })
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
  );
  app.use(
    "/api",
    rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 100000 : 300, standardHeaders: "draft-7", legacyHeaders: false })
  );

  // API responses hold personal data: never cache them, never index them.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // Only the CHAFADIA web app may call the API. It sends this header on every request; a browser
  // can only add a custom header from our own origin (CORS preflight), so other websites, links
  // and someone typing an API address into the address bar get 403. Real access control is still
  // the login + permission checks on each route. Webhooks come from providers and are verified
  // by their signature instead.
  app.use("/api", (req, _res, next) => {
    if (req.method === "OPTIONS" || isWebhook(req.originalUrl) || req.originalUrl === "/api/health") return next();
    if (req.get("x-requested-with") !== "chafadia") return next(new HttpError(403, "Forbidden", "FORBIDDEN"));
    next();
  });

  // Webhooks need the raw body for signature checks, so they are mounted before express.json().
  app.use((req, res, next) => (isWebhook(req.path) ? next() : express.json({ limit: "200kb" })(req, res, next)));
  app.use(cookieParser());

  app.use(
    "/uploads",
    express.static(config.UPLOAD_DIR, {
      fallthrough: false,
      index: false,
      dotfiles: "deny",
      setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=604800");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    })
  );

  app.get("/api/health", async (_req, res) => {
    await query("SELECT 1");
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api", catalogRoutes);
  app.use("/api/admin", adminCatalogRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/payments", paymentProofRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/receipts", receiptRoutes);
  app.use("/api/pos", posRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/whatsapp", whatsappRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api", adminRoutes);

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found", "NOT_FOUND")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed JSON" } });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: `File too large (max ${config.MAX_UPLOAD_MB} MB)` } });
    }
    if (err.name === "MulterError") {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Upload one image file only" } });
    }
    if (err.status === 404 && req.path.startsWith("/uploads")) {
      return res.status(404).end();
    }
    if (err.code === "23514" || err.code === "23505") {
      // DB constraint (e.g. stock would go negative) - never leak SQL details
      return res.status(409).json({ error: { code: "CONFLICT", message: "The request conflicts with current data. Please refresh and try again." } });
    }
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
  });

  return app;
}
