-- Setu — alter-002: the audience floor on clauses (task D1, Step 10a).
--
-- C1 added obligations.audience_id, which is where a FILED RULE records who it
-- binds. Pattern C needs somewhere earlier: the document-level audience is
-- stamped on every clause as a FLOOR, and D2 later overwrites it on the clauses
-- a chapter scopes more narrowly. Without this column there is nothing to stamp.
--
-- Idempotent, same as alter-001. Mirrored into init-db.sql.
--   psql -U setu_user -d setu_db -f alter-002.sql

BEGIN;

ALTER TABLE source_clauses
  ADD COLUMN IF NOT EXISTS audience_id INTEGER;

-- audience_source records WHICH pattern put it there, so D2 knows what it may
-- overwrite: a Pattern A chapter audience may narrow a Pattern C floor, but must
-- never silently replace an audience a human approved.
ALTER TABLE source_clauses
  ADD COLUMN IF NOT EXISTS audience_source TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_clauses_audience'
  ) THEN
    ALTER TABLE source_clauses
      ADD CONSTRAINT fk_source_clauses_audience
      FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_source_clauses_audience ON source_clauses (audience_id);

COMMIT;

DO $$ BEGIN RAISE NOTICE 'Setu alter-002: clause audience floor applied'; END $$;
