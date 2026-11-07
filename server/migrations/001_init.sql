-- CHAFADIA ENTERPRISE - initial schema
-- Money is stored as BIGINT in XAF (FCFA has no sub-unit).

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'cashier', 'customer', 'delivery');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE product_kind AS ENUM ('product', 'service');
CREATE TYPE order_channel AS ENUM ('online', 'pos');
CREATE TYPE fulfilment_type AS ENUM ('delivery', 'pickup', 'in_store');
CREATE TYPE order_status AS ENUM (
  'pending', 'paid', 'processing', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'refunded'
);
CREATE TYPE payment_method AS ENUM ('cash', 'mtn_momo', 'orange_money', 'card');
CREATE TYPE payment_status AS ENUM (
  'pending', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'
);
CREATE TYPE stock_movement_type AS ENUM ('purchase', 'sale', 'adjustment', 'return', 'cancellation');
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE refund_status AS ENUM ('pending', 'completed', 'failed', 'manual');
CREATE TYPE shift_status AS ENUM ('open', 'closed');

-- shared trigger to maintain updated_at
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- identity & RBAC
CREATE TABLE users (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email              TEXT NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  phone              TEXT,
  full_name          TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  password_hash      TEXT NOT NULL,
  role               user_role NOT NULL DEFAULT 'customer',
  status             user_status NOT NULL DEFAULT 'active',
  locale             TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr')),
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  token_version      INT NOT NULL DEFAULT 0,
  last_login_at      TIMESTAMPTZ,
  created_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE status <> 'deleted';
CREATE INDEX users_role_idx ON users (role, status);
-- only one owner account
CREATE UNIQUE INDEX users_single_super_admin_uq ON users (role) WHERE role = 'super_admin' AND status <> 'deleted';
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  grantable   BOOLEAN NOT NULL DEFAULT true  -- false = Super Admin only, can never be granted
);

CREATE TABLE role_permissions (
  role            user_role NOT NULL,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code)
);

-- per-user overrides of the role defaults (granted=false revokes a role default)
CREATE TABLE user_permissions (
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted         BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE refresh_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE password_resets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- audit log (append-only)
CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  actor_role  user_role,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);

CREATE FUNCTION audit_logs_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_changes();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_changes();

-- ---------------------------------------------------------------- settings
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  is_public   BOOLEAN NOT NULL DEFAULT false,
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- catalog
CREATE TABLE categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name_en     TEXT NOT NULL,
  name_fr     TEXT,
  parent_id   BIGINT REFERENCES categories(id),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE products (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  kind             product_kind NOT NULL DEFAULT 'product',
  category_id      BIGINT REFERENCES categories(id),
  collection       TEXT,
  name_en          TEXT NOT NULL,
  name_fr          TEXT,
  description_en   TEXT NOT NULL DEFAULT '',
  description_fr   TEXT,
  badge            TEXT,
  option_labels    JSONB NOT NULL DEFAULT '[]'::jsonb, -- selectable labels (size/colour) without separate stock
  is_featured      BOOLEAN NOT NULL DEFAULT false,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  duration_minutes INT CHECK (duration_minutes IS NULL OR duration_minutes > 0), -- services
  requires_booking BOOLEAN NOT NULL DEFAULT false,
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products (category_id) WHERE is_active;
CREATE INDEX products_search_idx ON products
  USING gin (to_tsvector('simple', name_en || ' ' || coalesce(name_fr, '') || ' ' || coalesce(collection, '') || ' ' || description_en));
CREATE TRIGGER products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE product_images (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT,
  sort_order  INT NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product_idx ON product_images (product_id, sort_order);

CREATE TABLE product_variants (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL UNIQUE,
  barcode             TEXT UNIQUE,
  name                TEXT NOT NULL DEFAULT 'Standard',
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  price               BIGINT NOT NULL CHECK (price >= 0),
  compare_at_price    BIGINT CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
  cost_price          BIGINT NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  track_stock         BOOLEAN NOT NULL DEFAULT true,
  stock_qty           INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INT NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reserved_within_stock CHECK (reserved_qty <= stock_qty)
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id);
CREATE TRIGGER product_variants_touch BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE stock_movements (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id      BIGINT NOT NULL REFERENCES product_variants(id),
  type            stock_movement_type NOT NULL,
  quantity        INT NOT NULL CHECK (quantity <> 0), -- signed: + in, - out
  stock_before    INT NOT NULL,
  stock_after     INT NOT NULL CHECK (stock_after >= 0),
  reference_type  TEXT,
  reference_id    TEXT,
  note            TEXT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_variant_idx ON stock_movements (variant_id, created_at DESC);

-- ---------------------------------------------------------------- customers & storefront
CREATE TABLE addresses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  recipient   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  line1       TEXT NOT NULL,
  city        TEXT,
  region      TEXT,
  country     TEXT NOT NULL DEFAULT 'CM',
  latitude    NUMERIC(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude   NUMERIC(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  place_id    TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses (user_id);

CREATE TABLE delivery_zones (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  fee         BIGINT NOT NULL CHECK (fee >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE coupons (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE CHECK (code = upper(code)),
  description    TEXT,
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  value          BIGINT NOT NULL CHECK (value > 0),
  min_order      BIGINT NOT NULL DEFAULT 0,
  max_uses       INT,
  used_count     INT NOT NULL DEFAULT 0,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT percent_le_100 CHECK (discount_type <> 'percent' OR value <= 100),
  CONSTRAINT uses_within_max CHECK (max_uses IS NULL OR used_count <= max_uses)
);

CREATE TABLE wishlists (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE reviews (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT CHECK (length(comment) <= 2000),
  status       review_status NOT NULL DEFAULT 'pending',
  moderated_by BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);

-- ---------------------------------------------------------------- POS shifts
CREATE TABLE cashier_shifts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cashier_id     BIGINT NOT NULL REFERENCES users(id),
  status         shift_status NOT NULL DEFAULT 'open',
  opening_float  BIGINT NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  expected_cash  BIGINT,
  counted_cash   BIGINT CHECK (counted_cash IS NULL OR counted_cash >= 0),
  variance       BIGINT,
  notes          TEXT,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX cashier_shifts_one_open_uq ON cashier_shifts (cashier_id) WHERE status = 'open';

-- ---------------------------------------------------------------- orders
CREATE SEQUENCE order_number_seq;
CREATE SEQUENCE receipt_number_seq;

CREATE TABLE orders (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number            TEXT NOT NULL UNIQUE,
  tracking_token          TEXT NOT NULL UNIQUE,
  channel                 order_channel NOT NULL,
  status                  order_status NOT NULL DEFAULT 'pending',
  customer_id             BIGINT REFERENCES users(id),
  customer_name           TEXT NOT NULL,
  customer_email          TEXT,
  customer_phone          TEXT,
  fulfilment              fulfilment_type NOT NULL,
  delivery_zone_id        BIGINT REFERENCES delivery_zones(id),
  delivery_address        TEXT,
  latitude                NUMERIC(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude               NUMERIC(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  place_id                TEXT,
  subtotal                BIGINT NOT NULL CHECK (subtotal >= 0),
  discount_total          BIGINT NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total               BIGINT NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  delivery_fee            BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  grand_total             BIGINT NOT NULL CHECK (grand_total >= 0),
  amount_paid             BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_refunded         BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  coupon_id               BIGINT REFERENCES coupons(id),
  payment_method          payment_method,
  stock_reserved          BOOLEAN NOT NULL DEFAULT false,
  reservation_expires_at  TIMESTAMPTZ,
  cashier_id              BIGINT REFERENCES users(id),
  shift_id                BIGINT REFERENCES cashier_shifts(id),
  delivery_person_id      BIGINT REFERENCES users(id),
  client_reference        TEXT UNIQUE, -- POS offline idempotency key
  needs_attention         TEXT,
  notes                   TEXT,
  status_changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                 TIMESTAMPTZ,
  delivered_at            TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT refund_within_paid CHECK (amount_refunded <= amount_paid)
);
CREATE INDEX orders_status_idx ON orders (status, status_changed_at);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);
CREATE INDEX orders_cashier_idx ON orders (cashier_id, created_at DESC);
CREATE INDEX orders_reservation_idx ON orders (reservation_expires_at) WHERE status = 'pending' AND stock_reserved;
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE order_items (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       BIGINT NOT NULL REFERENCES orders(id),
  product_id     BIGINT NOT NULL REFERENCES products(id),
  variant_id     BIGINT NOT NULL REFERENCES product_variants(id),
  kind           product_kind NOT NULL,
  product_name   TEXT NOT NULL,
  sku            TEXT NOT NULL,
  option_label   TEXT,
  quantity       INT NOT NULL CHECK (quantity > 0),
  unit_price     BIGINT NOT NULL CHECK (unit_price >= 0),
  unit_cost      BIGINT NOT NULL CHECK (unit_cost >= 0),
  line_total     BIGINT NOT NULL CHECK (line_total >= 0),
  booking_at     TIMESTAMPTZ -- services with scheduling
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_variant_idx ON order_items (variant_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE order_status_history (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     BIGINT NOT NULL REFERENCES orders(id),
  from_status  order_status,
  to_status    order_status NOT NULL,
  note         TEXT,
  changed_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

-- ---------------------------------------------------------------- payments
CREATE TABLE payments (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES orders(id),
  provider            TEXT NOT NULL,           -- mock | notchpay | cash | manual
  method              payment_method NOT NULL,
  amount              BIGINT NOT NULL CHECK (amount > 0),
  currency            TEXT NOT NULL DEFAULT 'XAF',
  status              payment_status NOT NULL DEFAULT 'pending',
  reference           TEXT NOT NULL UNIQUE,    -- our reference, sent to the provider
  provider_reference  TEXT,
  phone               TEXT,
  checkout_url        TEXT,
  failure_reason      TEXT,
  raw                 JSONB,
  recorded_by         BIGINT REFERENCES users(id),
  expires_at          TIMESTAMPTZ,
  succeeded_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_status_idx ON payments (status, expires_at);
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider, provider_reference) WHERE provider_reference IS NOT NULL;
-- at most one successful payment per order
CREATE UNIQUE INDEX payments_one_success_uq ON payments (order_id) WHERE status IN ('succeeded', 'refunded', 'partially_refunded');
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE payment_webhook_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider        TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  reference       TEXT,
  signature_valid BOOLEAN NOT NULL,
  payload         JSONB,
  processed_at    TIMESTAMPTZ,
  error           TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE refunds (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES orders(id),
  payment_id          BIGINT NOT NULL REFERENCES payments(id),
  amount              BIGINT NOT NULL CHECK (amount > 0),
  reason              TEXT NOT NULL,
  status              refund_status NOT NULL DEFAULT 'pending',
  restock             BOOLEAN NOT NULL DEFAULT false,
  provider_reference  TEXT,
  created_by          BIGINT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_idx ON refunds (order_id);

-- ---------------------------------------------------------------- receipts
CREATE TABLE receipts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_number  TEXT NOT NULL UNIQUE,
  order_id        BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  verify_token    TEXT NOT NULL UNIQUE,
  issued_by       BIGINT REFERENCES users(id),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  emailed_at      TIMESTAMPTZ,
  print_count     INT NOT NULL DEFAULT 0
);

CREATE TABLE receipt_prints (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id  BIGINT NOT NULL REFERENCES receipts(id),
  printed_by  BIGINT REFERENCES users(id),
  is_copy     BOOLEAN NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('80mm', 'a4')),
  printed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receipt_prints_receipt_idx ON receipt_prints (receipt_id);

-- ---------------------------------------------------------------- notifications & content
CREATE TABLE notifications (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE, -- NULL = all staff (admin + super admin)
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE announcements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  subject     TEXT,
  message     TEXT NOT NULL CHECK (length(message) <= 5000),
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description TEXT NOT NULL,
  category    TEXT,
  amount      BIGINT NOT NULL CHECK (amount > 0),
  spent_on    DATE NOT NULL DEFAULT current_date,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
