-- ─────────────────────────────────────────────────────────────────────────────
-- alter-007 — Step 13a, the Formula Register.
--
-- A definition is not a rule. "net worth = paid_up_capital + free_reserves -
-- accumulated_losses" imposes no duty; it says how one fact is COMPUTED from
-- others. Without somewhere to put that, the funnel meets `net_worth` in some
-- later rule and creates it as an ordinary attribute -- and the intake form then
-- asks the broker for their net worth instead of computing it from figures they
-- have already supplied.
--
-- `is_derived` is the flag that matters: the intake form only ever asks for the
-- LEAVES of the formula tree.
--
-- Definitions resolve BEFORE any rule, regardless of where they sat in the
-- document, which is what makes the wrong outcome impossible rather than
-- merely unlikely.
--
-- Idempotent. Mirrored into init-db.sql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS is_derived BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS formulas (
  id            SERIAL PRIMARY KEY,
  -- The attribute this formula computes. One formula per derived attribute:
  -- two circulars defining the same term differently is an AMENDMENT, not a
  -- second definition, and must be visible as such.
  attribute_id  INTEGER NOT NULL UNIQUE REFERENCES attributes(id) ON DELETE CASCADE,
  expression    TEXT NOT NULL,             -- as written, with registry refs
  -- The attributes it reads. A firm supplies these; it never supplies the result.
  input_ids     INTEGER[] NOT NULL DEFAULT '{}',
  source_doc    TEXT,
  source_clause TEXT,
  confidence    REAL,
  state         TEXT NOT NULL DEFAULT 'REVIEW',   -- PROPOSED|ACTIVE|REVIEW
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulas_attribute ON formulas (attribute_id);
CREATE INDEX IF NOT EXISTS idx_attributes_derived ON attributes (is_derived) WHERE is_derived;
