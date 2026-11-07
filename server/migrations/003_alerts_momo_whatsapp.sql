-- Per-admin read state for shared notifications, WhatsApp receipt delivery, settlement accounts.

-- Shared notifications (user_id IS NULL) are seen by every admin; each admin marks them read
-- for themselves, so one admin reading an alert does not hide it from the others.
CREATE TABLE notification_reads (
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX notifications_shared_idx ON notifications (created_at DESC) WHERE user_id IS NULL;

-- Customers choose whether receipts may be sent to them on WhatsApp (opt-in is required by WhatsApp).
ALTER TABLE users  ADD COLUMN whatsapp_opt_in BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN whatsapp_opt_in BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE receipts ADD COLUMN whatsapp_sent_at TIMESTAMPTZ;

-- What we know about each phone number on WhatsApp. WhatsApp has no lookup API, so the status is
-- learned from delivery reports: delivered/read => on WhatsApp, error 131026 => not on WhatsApp.
CREATE TABLE whatsapp_contacts (
  phone       TEXT PRIMARY KEY CHECK (phone ~ '^[0-9]{8,15}$'),  -- E.164 digits, e.g. 237652433338
  status      TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'on_whatsapp', 'not_on_whatsapp')),
  last_error  TEXT,
  checked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_messages (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone               TEXT NOT NULL,
  purpose             TEXT NOT NULL CHECK (purpose IN ('receipt', 'welcome')),
  order_id            BIGINT REFERENCES orders(id),
  receipt_id          BIGINT REFERENCES receipts(id),
  provider            TEXT NOT NULL,
  provider_message_id TEXT UNIQUE,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_messages_order_idx ON whatsapp_messages (order_id);
CREATE TRIGGER whatsapp_messages_touch BEFORE UPDATE ON whatsapp_messages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Where the shop's mobile money is withdrawn to (configure the same numbers as withdrawal
-- accounts in the payment provider's dashboard). Owner-only, never public.
INSERT INTO settings (key, value, is_public) VALUES
  ('settlement_accounts',
   '{"mtn_momo":{"number":"652433338","name":"CHAFIOU HAMIDOU"},"orange_money":{"number":"688332699","name":"SADIYATOU SEMIRNYUY KIKA"}}',
   false)
ON CONFLICT (key) DO NOTHING;
