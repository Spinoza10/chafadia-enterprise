# Contributing to CHAFADIA ENTERPRISE

Thank you for helping. This guide keeps the code consistent and the shop safe.

## 1. Set up your computer

You need **Node.js 20.12+** (22 recommended), **PostgreSQL 15+** and **Git**.

```bash
git clone https://github.com/Spinoza10/chafadia-enterprise.git
cd chafadia-enterprise
npm install
npm --prefix server install

cd server
npm run db:setup          # creates YOUR local database and server/.env (asks for your postgres password)
npm run db:seed           # imports the product catalogue
npm run seed:superadmin   # creates a local owner account for you
cd ..
```

Run it in two terminals:

```bash
npm run api:dev   # API on http://127.0.0.1:4000
npm run dev       # shop on http://localhost:5173
```

Everything works without real payment, email or WhatsApp accounts. Payments use screenshot upload,
and emails and WhatsApp messages are printed in the API terminal.

## 2. Workflow: branch, pull request, review

`main` is what goes live. Never commit to `main` directly.

1. Update: `git checkout main && git pull`
2. Create a branch: `git checkout -b feature/short-description` (or `fix/...`)
3. Make small, focused commits with clear messages, e.g. `Add delivery fee to receipts`.
4. Before pushing, run the checks (the same ones GitHub runs):
   ```bash
   npm run lint
   npm run build
   # backend tests need a Postgres superuser connection:
   TEST_DATABASE_ADMIN_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres npm --prefix server test
   ```
   On Windows PowerShell: `$env:TEST_DATABASE_ADMIN_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"; npm --prefix server test`
5. Push the branch: `git push -u origin feature/short-description`, then open a **Pull Request** on GitHub.
6. GitHub Actions runs lint, build and all backend tests. A red ❌ must be fixed before merging.
7. The owner reviews and merges. Delete the branch after merging.

## 3. Rules that keep the shop safe

- **Never commit secrets.** `server/.env`, passwords, API keys, tokens and customer data stay out of git.
  New settings go in `server/.env.example` (backend) or `.env.example` (frontend) with an empty or example value.
- **The server decides, never the browser.** Prices, stock, totals, permissions and payment status are
  always checked by the API. The website only hides what a role cannot use.
- **Database changes = a new migration.** Add `server/migrations/00N_description.sql` with the next number.
  Never edit a migration that has already been applied. Run `npm --prefix server run db:migrate`.
- **Money is in whole FCFA (integers).** No floating-point amounts.
- **Financial records are never deleted**: orders, payments, receipts, refunds, stock movements and the audit log.
  Corrections are new records (refund, adjustment) and are written to the audit log.
- **New API endpoint = permission check + input validation (zod) + a test** in `server/tests/`.
- **Product photos:** JPEG/PNG/WebP, at most about 1600 px wide and preferably under 500 KB.
  Large photos slow the shop on mobile data.

## 4. Code style

- The ESLint configuration in the repo is the standard; `npm run lint` must pass with no errors.
- `.editorconfig` sets 2-space indentation and LF line endings; most editors apply it automatically.
- Plain, clear English in the user interface and in error messages ("Enter your phone number", not "Invalid input").
- Keep components and functions small, and name things after what they mean in the shop (order, receipt, cashier).

## 5. Where things are

| Path | What |
|---|---|
| `src/` | React website (pages, components, `lib/api.js` client) |
| `server/src/routes/` | API endpoints |
| `server/src/services/` | Business logic (orders, payments, receipts, WhatsApp) |
| `server/migrations/` | Database schema, applied in order |
| `server/tests/` | Backend tests (run on a throwaway database) |

See `README.md` for roles, payment rules, WhatsApp setup and deployment.
