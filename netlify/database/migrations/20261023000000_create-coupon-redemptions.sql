CREATE TABLE coupon_redemptions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  email TEXT NOT NULL,
  item_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, email)
);
