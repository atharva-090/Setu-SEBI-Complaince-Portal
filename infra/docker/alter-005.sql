-- ─────────────────────────────────────────────────────────────────────────────
-- alter-005 — Step 10e (D2): the approval gate gets somewhere to live.
--
-- Creating a new audience requires a human click. That is the one deliberate
-- interruption in the pipeline, and it buys a hard guarantee: a wrongly created
-- audience produces the DUPLICATE BRANCH problem — two QSB nodes, rules
-- scattered across both, and a firm seeing half its obligations with no sign
-- the rest exists. Nothing downstream can detect that, because both branches
-- look perfectly valid.
--
-- D1 computed `needsApproval` and then dropped it on the floor: a row created
-- at 0.35 confidence was indistinguishable from one at 0.95. Pattern C alone
-- made one audience per document so it barely showed; Pattern A mints one per
-- chapter, and the queue is now real.
--
-- EXISTING ROWS BECOME 'PROPOSED', not 'APPROVED'. Every audience in the
-- register was created by the mock classifier at 0.35 and none has ever been
-- approved by anyone. Backfilling them as approved would be a lie told once
-- and believed forever.
--
-- Idempotent. Mirrored into init-db.sql for a fresh volume.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audiences
  ADD COLUMN IF NOT EXISTS state      TEXT NOT NULL DEFAULT 'PROPOSED',  -- PROPOSED|APPROVED
  ADD COLUMN IF NOT EXISTS confidence REAL,
  ADD COLUMN IF NOT EXISTS approved_by  TEXT,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_audiences_state ON audiences (state);
