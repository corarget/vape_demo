-- Phase 2: transactional order operations.
CREATE TABLE IF NOT EXISTS checkout_requests (
  idempotency_key TEXT PRIMARY KEY,
  customer_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkout_requests_customer ON checkout_requests(customer_key_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved','released','consumed')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, product_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_item ON inventory_reservations(product_id, sku, status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded')),
  idempotency_key TEXT UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS promocode_redemptions (
  id TEXT PRIMARY KEY,
  promocode TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(promocode, order_id)
);
CREATE INDEX IF NOT EXISTS idx_promocode_redemptions_code ON promocode_redemptions(promocode);
