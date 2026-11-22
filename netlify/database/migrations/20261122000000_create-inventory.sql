-- Per-size stock for pieces sold in limited numbers. A size with qty 0 is sold out.
CREATE TABLE inventory (
  item_id TEXT NOT NULL,
  size TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (item_id, size)
);

-- The '80s Jumpsuit (From the Vault, Fall/Winter 2019): 10 per size.
INSERT INTO inventory (item_id, size, qty) VALUES
  ('80s-jumpsuit', 'S', 10),
  ('80s-jumpsuit', 'M', 10),
  ('80s-jumpsuit', 'L', 10);
