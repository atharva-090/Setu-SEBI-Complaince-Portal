-- ─────────────────────────────────────────────────────────────────────────────
-- alter-004 — Step 16 (D8): a rule remembers which clause produced it.
--
-- A citation names a CLAUSE; an edge joins RULES. Resolving one into the other
-- needs the clause→rules map, and until now nothing stored it: `source_spans`
-- carries the clause NUMBER as text, and Decision 66 already established that a
-- clause number is not a key ("1" is 152 distinct clauses in CSCRF). Linking on
-- it would join the wrong rules and be impossible to audit afterwards.
--
-- ON DELETE SET NULL, not CASCADE: re-ingesting a document replaces its clause
-- rows, and a rule must survive that. It becomes unlinkable, not deleted —
-- the next ingest re-stamps it.
--
-- Idempotent. Mirrored into init-db.sql for a fresh volume.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE obligations
  ADD COLUMN IF NOT EXISTS source_clause_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_obligations_source_clause'
  ) THEN
    ALTER TABLE obligations
      ADD CONSTRAINT fk_obligations_source_clause
      FOREIGN KEY (source_clause_id) REFERENCES source_clauses(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_obligations_source_clause
  ON obligations (source_clause_id);

-- The sweep asks "who was waiting for me?" keyed on container + number, so the
-- pending queue is indexed the same way it is queried.
CREATE INDEX IF NOT EXISTS idx_unresolved_citations_target
  ON unresolved_citations (target_clause_no, target_container) WHERE state = 'PENDING';

-- An edge is a fact about a PAIR, and a re-ingest must not duplicate it. Partial
-- on ACTIVE|REVIEW so a future retracted edge does not block re-creation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_edges_from_to_type
  ON edges (from_id, to_id, type);
