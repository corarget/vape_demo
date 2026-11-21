CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  category TEXT,
  brand TEXT,
  query_text TEXT,
  visitor_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_product_created ON analytics_events(product_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_created ON analytics_events(event_type,created_at DESC);
