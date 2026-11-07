import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool, query, tx } from "./db.js";
import { expireStale } from "./services/orders.js";
import { remindStaleProofs } from "./services/paymentProofs.js";

const app = createApp();
const server = app.listen(config.PORT, config.HOST, () => {
  console.log(
    `CHAFADIA API listening on http://${config.HOST}:${config.PORT} (${config.NODE_ENV}, payments: ${config.PAYMENT_PROVIDER}, whatsapp: ${config.WHATSAPP_PROVIDER})`
  );
});

// Release stock held by unpaid orders and expire stale payments.
let timer;
if (config.RUN_JOBS) {
  timer = setInterval(async () => {
    try {
      const r = await expireStale(tx);
      if (r.orders || r.payments) console.log(`[jobs] expired ${r.orders} orders, ${r.payments} payments`);
      const reminded = await remindStaleProofs(query);
      if (reminded) console.log(`[jobs] reminded admins about ${reminded} payment(s) waiting for approval`);
    } catch (err) {
      console.error("[jobs] expiry failed", err.message);
    }
  }, 60_000);
}

function shutdown() {
  clearInterval(timer);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
