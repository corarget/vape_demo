CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','courier')),
  telegram_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_telegram_id ON staff(telegram_id) WHERE telegram_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','courier')),
  telegram_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  customer_key_hash TEXT NOT NULL,
  telegram_user_id TEXT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_method TEXT NOT NULL CHECK(delivery_method IN ('pickup','delivery')),
  address TEXT,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BYN',
  payment_method TEXT NOT NULL DEFAULT 'upon_receipt',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  courier_id TEXT REFERENCES staff(id),
  manager_id TEXT REFERENCES staff(id),
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_key_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(slot_date,slot_time,delivery_method,status);
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id,status,slot_date,slot_time);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_key TEXT,
  sku TEXT,
  product_name TEXT NOT NULL,
  manufacturer TEXT,
  option_label TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  quantity INTEGER NOT NULL CHECK(quantity>0),
  unit_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id,created_at);

CREATE TABLE IF NOT EXISTS slot_blocks (
  id TEXT PRIMARY KEY,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  method TEXT NOT NULL DEFAULT 'all' CHECK(method IN ('all','pickup','delivery')),
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_rows INTEGER,
  product_families INTEGER,
  variants INTEGER,
  error TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
