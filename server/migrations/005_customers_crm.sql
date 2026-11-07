-- Quick sign-up (phone + password, email optional) and customer management with WhatsApp messaging.

-- Customers may register with only a phone number. Staff accounts still always have an email
-- (enforced by the staff API). Every account needs at least one way to log in.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_present CHECK (email IS NOT NULL OR phone IS NOT NULL);
-- phone numbers are stored as +<country><number>, e.g. +237652433338, and identify the account
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE status <> 'deleted' AND phone IS NOT NULL;

ALTER TABLE users ADD COLUMN notes  TEXT;
ALTER TABLE users ADD COLUMN tags   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT 'signup' CHECK (source IN ('signup', 'checkout', 'admin', 'seed'));
UPDATE users SET source = 'seed' WHERE role <> 'customer';

-- Conversation history: messages sent from the system and replies received on WhatsApp.
ALTER TABLE whatsapp_messages DROP CONSTRAINT whatsapp_messages_purpose_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_purpose_check
  CHECK (purpose IN ('receipt', 'welcome', 'reset', 'message', 'broadcast', 'inbound'));
ALTER TABLE whatsapp_messages DROP CONSTRAINT whatsapp_messages_status_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received'));
ALTER TABLE whatsapp_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out', 'in'));
ALTER TABLE whatsapp_messages ADD COLUMN body      TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN user_id   BIGINT REFERENCES users(id);
ALTER TABLE whatsapp_messages ADD COLUMN sent_by   BIGINT REFERENCES users(id);
CREATE INDEX whatsapp_messages_phone_idx ON whatsapp_messages (phone, created_at DESC);

-- A customer who wrote to us in the last 24 h can get a free-text reply (WhatsApp rule);
-- otherwise the system uses the approved message template.
ALTER TABLE whatsapp_contacts ADD COLUMN last_inbound_at TIMESTAMPTZ;

INSERT INTO permissions (code, description, category, grantable) VALUES
  ('customers.manage',  'View, edit and export registered customers',      'Customers', true),
  ('customers.message', 'Send WhatsApp messages and broadcasts to customers', 'Customers', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'customers.manage'),
  ('admin', 'customers.message')
ON CONFLICT DO NOTHING;
