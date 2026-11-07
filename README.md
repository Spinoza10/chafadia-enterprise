# CHAFADIA ENTERPRISE - online shop, POS and back office

Online and in-store shop for products and services in Cameroon (XAF). The owner (Super Admin)
controls everything; admins, cashiers and delivery staff get only what their role allows.

| Part | Stack |
|---|---|
| Frontend | React 19 + Vite (this folder) |
| API | Node.js 20+ / Express 5 (`server/`) |
| Database | PostgreSQL 15+ (developed on 18), plain SQL migrations in `server/migrations/` |
| Auth | argon2id passwords, 15-min JWT access token (memory only) + rotating httpOnly refresh cookie |
| Payments | Provider interface (`server/src/payments/`): `mock` for development, `notchpay` (MTN MoMo, Orange Money, cards) |

## 1. First-time setup (Windows, macOS or Linux)

Requirements: Node.js 20+ and PostgreSQL running locally (DBeaver is optional, for browsing data).

```bash
# install
npm install
npm --prefix server install

# create the database chafadia_enterprise + 2 roles, apply migrations, write server/.env
cd server
npm run db:setup          # asks for your "postgres" password (input hidden). Other databases are not touched.
npm run db:seed           # imports the 86 existing products
npm run seed:superadmin   # creates the owner account (asks for name, email, password)
```

`db:setup` creates:

- **`chafadia_enterprise_owner`** - owns the schema, used only for migrations (`MIGRATION_DATABASE_URL`).
- **`chafadia_enterprise_app`** - used by the running API (`DATABASE_URL`). It cannot UPDATE/DELETE the
  audit log and cannot DELETE orders, payments, receipts, refunds or stock movements.

To see the tables in DBeaver: *New connection > PostgreSQL*, host `localhost`, port `5432`,
database `chafadia_enterprise`, user `postgres` (or the owner role from `server/.env`).

## 2. Run in development

Two terminals:

```bash
npm run api:dev     # API on http://localhost:4000
npm run dev         # shop on http://localhost:5173 (proxies /api to the API)
```

Open http://localhost:5173, log in with the owner account, then create staff in **Staff & permissions**.

Payments run in **test mode** (`PAYMENT_PROVIDER=mock`): checkout redirects to a simulated gateway page
where you click *Approve* or *Decline*. It sends a real HMAC-signed webhook, so the production code
path (signature check, re-verification, idempotency) is exercised. Emails are printed in the API
console until SMTP is configured.

## 3. Roles

| Role | Can | Cannot |
|---|---|---|
| Super Admin (owner) | Everything: staff and permissions, settings, taxes, delivery zones, coupons, refunds, full reports (profit), payments, audit log | - |
| Admin | Add/edit products & services, prices, cost prices, stock; view orders; delivery workflow and assignment; print/reprint receipts; total sold; slow products and stuck orders | Manage staff, settings, payment keys, refunds, delete financial records, see profit |
| Cashier | POS sales (cash, MoMo, Orange, card), shift open/close, own sales and daily summary, reprint receipts, record cash on pending orders | Products, stock, others' sales, discounts (unless granted) |
| Delivery | Assigned orders only: directions, out for delivery / delivered, collect cash on delivery | Everything else |
| Customer | Register/login or guest checkout, pay, track, download receipts, order history, reviews | - |

The owner can grant or remove individual permissions per person (permission matrix). `users.manage`,
`settings.manage`, `refunds.manage` and `audit.view` can never be granted to anyone else.
Every rule is enforced by the API; the UI only hides what a role cannot use.

## 4. Order, payment and stock rules

1. Checkout creates the order **pending**. Prices come from the database, never the browser.
2. Stock is **reserved** (row-locked, so two customers cannot buy the last unit).
3. Payment is initiated with the provider. The order becomes **paid only after the provider's webhook**
   passes the signature check *and* the API re-checks the payment status with the provider.
4. On payment: stock is deducted, a stock movement is logged, a receipt number is issued (`RCP-YYYY-000001`),
   and the PDF receipt is sent by email **and on WhatsApp** (see below).
5. Unpaid orders expire (30 min online, 48 h for cash on pickup/delivery; configurable). Stock is released.
6. Duplicate webhooks are ignored. A payment arriving after expiry is kept and flagged "refund required".
7. Refunds (owner only) can be partial or full; full refunds can restock exactly what was sold.
8. Delivery flow: pending -> paid -> processing -> out for delivery -> delivered (pickup: -> completed).
   Customers get an email at each step.

### Sold out and sale alerts

- **Every sale** (online or POS) creates a notification for every admin and the owner listing what was sold,
  the total and who sold it. **Sold out**, **low stock** and **back in stock** alerts work the same way.
  They appear in the 🔔 bell in the navbar (refreshed every 20 s, with a pop-up for new ones). Each admin
  has their own read/unread state. `alert_email` in Settings also receives low-stock and sold-out alerts.
- **Customers** see "Sold out" on product cards. The shop re-checks the items in their cart and wishlist
  every 20 s (`GET /api/products/availability`). If one sells out, a red banner appears on every page,
  the cart line is marked, and checkout is blocked until the cart is fixed. The server re-checks stock
  at checkout, so the last unit can never be sold twice.

### Online payments: Mobile Money transfer + screenshot, approved by admins (default)

With `ONLINE_PAYMENT_MODE=manual` (the default), every online payment is finished by the admins:

1. At checkout the customer chooses MTN MoMo or Orange Money (or cash). Card is not offered in this mode.
   They see the shop's number and account name: MoMo **652433338 (CHAFIOU HAMIDOU)**, Orange Money
   **688332699 (SADIYATOU SEMIRNYUY KIKA)**. The owner can edit these in Settings.
2. On the **Pay** page they see the exact amount, the order number to use as the note, copy buttons and a
   "Dial *126# / #150#" button. They send the money **from their own phone**, confirming with their PIN there.
3. They upload the **screenshot** of the confirmation, with the transaction ID, the number they paid from
   and the account name. The order is then "under review" and its items stay reserved. Orders under review
   never expire.
4. Every admin and the owner get a notification. In **Verify payments** they see the screenshot next to the
   order. Each approval asks the admin to tick "the money is in the shop's account".
5. By default **two different admins** must approve (owner + admin). The same person cannot approve twice.
   The owner can change this to 1-3 in Settings; it never asks for more approvers than exist.
6. On the final approval the order becomes **paid**: stock is deducted, the receipt is issued and sent by
   email and WhatsApp, and the customer sees "✅ Payment approved" on screen and gets an email. The Pay page
   shows "1 of 2 approvals" live while they wait.
7. A **rejection** needs a reason, which the customer sees on screen and by email. Their items stay reserved
   24 hours more so they can upload the correct screenshot.

Safeguards:
- The same transaction ID or the same screenshot file can never pay two orders.
- Only JPEG/PNG/WebP files (checked by content, max 5 MB) are accepted, and they are stored in a private
  folder (`PROOF_DIR`). They are visible only to staff with `payments.verify` and to the order's owner.
- Warnings are shown to admins: sender on the wrong network, amount different from the amount due, sender
  is the shop's own number, earlier rejected screenshots.
- If a screenshot waits more than 2 hours, every admin gets a reminder.
- Every submission, approval and rejection is in the audit log.
- `payments.verify` is a permission: admins have it by default, and the owner can remove it per person.

### Mobile Money direct charge (`ONLINE_PAYMENT_MODE=gateway`)

When a Notch Pay account is set up, MTN MoMo and Orange Money can instead be charged directly. The customer enters the number that pays, the payment
provider pushes a prompt to that phone, and the customer types **their PIN on their own phone**. The money
is withdrawn as soon as they confirm. The website never asks for or sees the PIN; MTN and Orange do not
allow merchants to collect it. The number is checked against the chosen network (MTN 67x/650-654/680-683,
Orange 69x/655-659/686-689). A declined or expired prompt can be retried with another number.
In test mode (`PAYMENT_PROVIDER=mock`) the payment page shows a simulated phone instead.

The money lands in the Notch Pay merchant balance. Register the shop's withdrawal accounts (owner-only,
editable in **Settings > Mobile money withdrawal accounts**) in the Notch Pay dashboard so the balance is
paid out to them.

### WhatsApp receipts

The receipt PDF goes to the customer's **registered phone number** (or the checkout number for guests)
on WhatsApp, in addition to email. Customers can opt out at sign-up or checkout.

WhatsApp has no API to look up whether a number uses WhatsApp, so the system learns it from delivery
reports. A delivered or read message marks the number "on WhatsApp". Error 131026 marks it "not on WhatsApp",
and the system stops sending to that number for 30 days. The check runs at sign-up (welcome message, if
`WHATSAPP_WELCOME_TEMPLATE` is set) and on every receipt. Staff see the result in the order detail and can resend.

To go live with the official Meta WhatsApp Cloud API:

1. Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, then add the shop's phone number.
2. In WhatsApp Manager create a **Utility** template named `order_receipt`, language English, with a
   **Document** header and this body:
   `Hello {{1}}, thank you for shopping at CHAFADIA ENTERPRISE. Order {{2}}, total paid {{3}}. Your receipt {{4}} is attached.`
3. In `server/.env` set `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_TOKEN` (permanent system-user token),
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and a random `WHATSAPP_VERIFY_TOKEN`.
4. Set the app's webhook to `https://YOUR_DOMAIN/api/whatsapp/webhook` with that verify token and
   subscribe to `messages`. The API checks Meta's `X-Hub-Signature-256` on every call.

### Quick sign-up and the customer directory

- **Sign-up** asks only for name, phone number (WhatsApp) and a password: 8+ characters with a letter and a
  number for customers; staff keep 10+. Email is optional. Every password field has a 👁 show/hide button
  and live ✓ checks ("At least 8 characters", "Passwords match").
- People log in with their **phone number (typed any way) or email**. Phone numbers are stored as
  `+237XXXXXXXXX`, and there is one account per phone and per email.
- Forgot password works with the phone number: the link is sent on WhatsApp (and by email if there is one).
  The link is never stored in the message history.
- Guests can tick "Create my account" at checkout; the order is saved to the new account.
- Every new customer triggers a 🔔 notification, and a WhatsApp check of their number.
- **Customers** screen (`customers.manage`): search by name/phone/email, filter by WhatsApp status or tag, sort
  by spending, edit details, keep private notes and tags, suspend, and export to CSV (safe to open in Excel).
- **WhatsApp from the system** (`customers.message`):
  - "Chat" opens WhatsApp directly (wa.me). It works with no setup.
  - "Send on WhatsApp" sends from the shop's number and keeps the conversation history, including customer
    replies, which arrive through the webhook and appear in the 🔔 bell.
  - "Message to many" broadcasts to everyone, the ticked customers, or a tag. It skips people who turned off
    WhatsApp messages and numbers that are not on WhatsApp, and sends a summary notification at the end.
- WhatsApp only allows free text within 24 h of the customer's last message. Otherwise the system uses
  the approved template. Create these Utility templates in WhatsApp Manager:
  - `customer_message`: `Hello {{1}}, {{2}}`
  - `password_reset`: `Hello {{1}}, use this link within 30 minutes to reset your CHAFADIA password: {{2}}`

### API protection

- The API listens on `127.0.0.1` only (`HOST`), so nothing on the network can reach port 4000 directly.
  Only the Vite proxy (development) or nginx (production) on the same machine talks to it.
- Every `/api` request must carry the web app's `X-Requested-With: chafadia` header. A browser can only add it
  from the shop's own site, so other websites, links and anyone typing an API address into the address bar
  get 403. Payment and WhatsApp webhooks are exempt and must have a valid signature instead.
- API responses are `Cache-Control: no-store` and `X-Robots-Tag: noindex`; there are no source maps in the build.
- This hides the API from casual access, but the real protection is the login, role and permission checks on
  every route, the rate limits, and the signed webhooks. Any web app's requests remain visible in the
  user's own browser developer tools; that is normal and safe because the server re-checks everything.

## 5. Going live with real payments (Notch Pay)

Notch Pay is a Cameroonian aggregator that supports MTN MoMo, Orange Money and cards in XAF.

1. Create a business account at notchpay.co and complete verification.
2. In `server/.env` set `PAYMENT_PROVIDER=notchpay`, plus `NOTCHPAY_PUBLIC_KEY`, `NOTCHPAY_PRIVATE_KEY`
   and `NOTCHPAY_WEBHOOK_HASH`. Use **test** keys first.
3. In the Notch Pay dashboard, set the webhook URL to `https://YOUR_DOMAIN/api/payments/webhook/notchpay`.
4. Make real test payments in sandbox and confirm each order turns paid. The adapter is
   `server/src/payments/notchpay.js`; adjust field names there if their API differs.
5. Switch to live keys only after sandbox works. The API refuses to start in production with `mock`.

Another provider (Campay, CinetPay, Flutterwave) is a new file implementing the same four methods
(`initiate`, `verifyWebhook`, `fetchStatus`, `refund`), registered in `server/src/payments/index.js`.

## 6. Environment variables

- Backend: see [server/.env.example](server/.env.example). Secrets live only there, never in code or the frontend.
- Frontend: see [.env.example](.env.example). `VITE_GOOGLE_MAPS_API_KEY` is optional. Restrict the key to your
  domain (HTTP referrer) and to the Maps JavaScript + Places APIs.

## 7. Tests

```bash
# needs a superuser connection to a Postgres server; a throwaway database "chafadia_test" is created
TEST_DATABASE_ADMIN_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres npm run api:test
```

On Windows PowerShell:

```powershell
$env:TEST_DATABASE_ADMIN_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"; npm run api:test
```

There are 107 tests covering quick sign-up and phone login, the customer directory and WhatsApp messaging, screenshot payments with two-admin approval, API protection, sold-out and sale alerts, mobile money direct charge, WhatsApp receipts, auth (lockout, refresh rotation and reuse detection, reset), RBAC for every role, audit
immutability, overselling under concurrency, webhook signatures and idempotency, expiry, refunds,
POS shifts and receipts.

## 8. Deployment (single server)

1. A Linux VPS with Node 20+, PostgreSQL and nginx. HTTPS via Let's Encrypt (`certbot --nginx`).
2. `npm ci && npm run build` produces `dist/`. Serve it with nginx and add an SPA fallback to `index.html`.
3. Proxy `/api` and `/uploads` to the API (`localhost:4000`) on the **same domain** so the refresh
   cookie stays `SameSite=Strict`:

   ```nginx
   location /api/     { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
   location /uploads/ { proxy_pass http://127.0.0.1:4000; }
   location /         { root /var/www/chafadia/dist; try_files $uri /index.html; }
   ```

4. `server/.env`: `NODE_ENV=production`, `TRUST_PROXY=true`, `FRONTEND_URL=https://YOUR_DOMAIN`,
   `CORS_ORIGINS=https://YOUR_DOMAIN`, real SMTP, real payment keys.
5. Run the API with a process manager, e.g. `pm2 start server/src/index.js --name chafadia-api`.
6. Run `npm --prefix server run db:migrate` on every deploy.
7. Backups, nightly:
   `pg_dump -Fc chafadia_enterprise > /backups/chafadia-$(date +%F).dump`. Also copy `server/uploads/`.
   To restore: `pg_restore --clean -d chafadia_enterprise FILE.dump`.
