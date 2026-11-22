-- Per-size stock for pieces sold in limited numbers. Checkout takes one unit before charging and
-- puts it back if the payment fails. A size at 0 shows as Sold Out on the site.
CREATE TABLE size_inventory (
  item_id TEXT NOT NULL,
  size TEXT NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  PRIMARY KEY (item_id, size)
);

-- The '80s Jumpsuit (The Vault): 10 per size.
INSERT INTO size_inventory (item_id, size, remaining) VALUES
  ('80s-jumpsuit', 'S', 10),
  ('80s-jumpsuit', 'M', 10),
  ('80s-jumpsuit', 'L', 10);
