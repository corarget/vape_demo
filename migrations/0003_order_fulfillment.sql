ALTER TABLE orders ADD COLUMN fulfillment_method TEXT NOT NULL DEFAULT 'pickup';
ALTER TABLE orders ADD COLUMN doorbell TEXT NOT NULL DEFAULT '';
UPDATE orders SET fulfillment_method=delivery_method WHERE delivery_method='delivery';
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_slot ON orders(slot_date,slot_time,fulfillment_method,status);
