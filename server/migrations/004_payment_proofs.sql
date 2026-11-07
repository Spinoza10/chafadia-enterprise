-- Manual mobile money payments: the customer sends money to the shop's MoMo / Orange Money number,
-- uploads a screenshot of the transfer, and admins verify it before the order is paid.

INSERT INTO permissions (code, description, category, grantable) VALUES
  ('payments.verify', 'Check payment screenshots and approve or reject online payments', 'Finance', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role, permission_code) VALUES ('admin', 'payments.verify') ON CONFLICT DO NOTHING;

-- Customers must see where to send the money, so the shop's receiving accounts become public.
UPDATE settings SET is_public = true WHERE key = 'settlement_accounts';
INSERT INTO settings (key, value, is_public) VALUES
  ('payment_approvals_required', '2', false),   -- different admins who must approve each payment
  ('proof_review_hours', '48', false)            -- items stay reserved this long while a proof is reviewed
ON CONFLICT (key) DO NOTHING;

CREATE TABLE payment_proofs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id       BIGINT NOT NULL REFERENCES payments(id),
  order_id         BIGINT NOT NULL REFERENCES orders(id),
  method           payment_method NOT NULL CHECK (method IN ('mtn_momo', 'orange_money')),
  amount_due       BIGINT NOT NULL,
  amount_claimed   BIGINT,
  transaction_id   TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 4 AND 60),
  sender_phone     TEXT NOT NULL,
  sender_name      TEXT NOT NULL,
  paid_to          TEXT NOT NULL,                 -- shop number shown to the customer at the time
  image_path       TEXT NOT NULL,                 -- file name in the private proofs folder (never public)
  image_sha256     TEXT NOT NULL,
  image_type       TEXT NOT NULL,
  image_bytes      INT NOT NULL,
  note             TEXT,
  warnings         JSONB NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
  approvals_required INT NOT NULL DEFAULT 1,
  rejection_reason TEXT,
  reviewed_by      BIGINT REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  submitted_by     BIGINT REFERENCES users(id),
  submitted_ip     TEXT,
  reminded_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_proofs_status_idx ON payment_proofs (status, created_at);
CREATE INDEX payment_proofs_order_idx ON payment_proofs (order_id);
-- the same MoMo transaction or the same screenshot cannot pay for two orders
CREATE UNIQUE INDEX payment_proofs_txn_uq ON payment_proofs (method, upper(transaction_id)) WHERE status <> 'rejected';
CREATE UNIQUE INDEX payment_proofs_image_uq ON payment_proofs (image_sha256) WHERE status <> 'rejected';
-- one proof under review per order at a time
CREATE UNIQUE INDEX payment_proofs_one_open_uq ON payment_proofs (order_id) WHERE status = 'pending_review';

CREATE TABLE payment_approvals (
  proof_id    BIGINT NOT NULL REFERENCES payment_proofs(id),
  approver_id BIGINT NOT NULL REFERENCES users(id),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proof_id, approver_id)            -- one approval per admin: two admins means two people
);
