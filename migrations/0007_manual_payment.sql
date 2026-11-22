ALTER TABLE orders ADD COLUMN transfer_details TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN recovery_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_recovery_hash ON orders(recovery_hash) WHERE recovery_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_recovery_sessions (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, customer_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_order_recovery_sessions_customer ON order_recovery_sessions(customer_key_hash);
