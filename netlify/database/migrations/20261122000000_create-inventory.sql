-- Per-size stock for pieces with limited inventory. Stock counts are never shown on the site;
-- a size with 0 left is shown as Sold Out.
CREATE TABLE inventory (
  item_id TEXT NOT NULL,
  size TEXT NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  PRIMARY KEY (item_id, size)
);

-- One unit held per checkout attempt (by idempotency key) while the card is charged.
-- Paid holds are the sale record; failed payments delete their hold and return the unit to stock.
CREATE TABLE inventory_holds (
  idempotency_key TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  size TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The Oscar Gold Jumpsuit (From the Vault, Fall/Winter 2019): 10 per size.
INSERT INTO inventory (item_id, size, stock) VALUES
  ('oscar-gold-jumpsuit', 'S', 10),
  ('oscar-gold-jumpsuit', 'M', 10),
  ('oscar-gold-jumpsuit', 'L', 10);
