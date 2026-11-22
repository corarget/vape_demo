ALTER TABLE orders ADD COLUMN telegram_username TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_telegram_user_id ON orders(telegram_user_id,created_at DESC);
