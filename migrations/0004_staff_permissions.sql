ALTER TABLE staff ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE staff_invites ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';

UPDATE staff SET permissions_json='["overview","orders","orders.manage","schedule","catalog","catalog.manage","categories","categories.manage","analytics","branding","branding.manage","settings","logs","telegram"]' WHERE role='manager';
UPDATE staff_invites SET permissions_json='["overview","orders","orders.manage","schedule","catalog","catalog.manage","categories","categories.manage","analytics","branding","branding.manage","settings","logs","telegram"]' WHERE role='manager';

CREATE TABLE IF NOT EXISTS demo_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT
);
