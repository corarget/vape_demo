-- Allow metro-specific blocks without changing the already-applied 0001 schema.
-- slot_blocks has no inbound foreign keys, so rebuilding it preserves existing data safely.
BEGIN;

CREATE TABLE slot_blocks_rebuild (
  id TEXT PRIMARY KEY,
  slot_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  method TEXT NOT NULL DEFAULT 'all' CHECK(method IN ('all','metro','pickup','delivery')),
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO slot_blocks_rebuild (
  id, slot_date, start_time, end_time, method, reason, created_by, created_at
)
SELECT id, slot_date, start_time, end_time, method, reason, created_by, created_at
FROM slot_blocks;

DROP TABLE slot_blocks;
ALTER TABLE slot_blocks_rebuild RENAME TO slot_blocks;

COMMIT;
