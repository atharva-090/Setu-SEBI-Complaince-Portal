-- Setu — alter-001: schema for Steps 14, 15 and 16 (task C1).
--
-- WHY THIS FILE EXISTS
--   init-db.sql is mounted at /docker-entrypoint-initdb.d and postgres runs it
--   ONLY on an empty data volume. Editing it does nothing to a database that
--   already has data. So every change lands twice: in init-db.sql for fresh
--   environments, and here for the volume you are already using.
--
--   Everything below is IDEMPOTENT. Running it twice is a no-op, not an error.
--
--   psql -U setu_user -d setu_db -f alter-001.sql
--
-- Adopting real migration tooling is the alternative. It is more work than this
-- milestone needs and can wait until a second person is applying schema changes.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · audiences — the applicability layer (Step 10)
--
-- NOT in the original C1 list, and the list was incomplete: `obligations.
-- audience_id` has to reference something, and Step 10 resolves headings against
-- an "Audience Register" that has no table. An audience is a SET OF FIRMS, so it
-- is matched by its normalised test character-for-character, never by name
-- similarity — `predicate_hash` is that exact-match key.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audiences (
  id             SERIAL PRIMARY KEY,
  label          TEXT NOT NULL,               -- "Qualified Stock Brokers"
  predicate      TEXT NOT NULL,               -- category=='stock_broker' && is_qsb==true
  predicate_hash TEXT NOT NULL UNIQUE,        -- rung 3: exact match on the TEST
  properties     TEXT[] NOT NULL DEFAULT '{}',-- firm-property vocabulary used
  aliases        TEXT[] NOT NULL DEFAULT '{}',-- headings that resolved here
  pattern        TEXT,                        -- C|A|B — which pattern produced it
  created_from   TEXT,                        -- provenance: doc#clause
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lattice is a DAG, not a tree: an audience can be narrower than several
-- others at once. D2 records containment here; D9 reads it to tell a genuine
-- contradiction from a narrower rule legitimately overriding a broader one.
CREATE TABLE IF NOT EXISTS audience_edges (
  narrower_id INTEGER NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  broader_id  INTEGER NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  derivation  TEXT,                           -- how containment was established
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (narrower_id, broader_id),
  CHECK (narrower_id <> broader_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · obligations.audience_id + hash_inputs (Step 14)
--
-- audience_id: the live bug. identity_hash is currently computed from the
-- expression alone, so the QSB 180-day rule and the non-QSB 90-day rule both
-- mask to `#4471<=NUM` and collide. Decisions 74, 85.
--
-- hash_inputs: identity is built from registry ids, and Step 13's cold-start
-- clustering renumbers those. Storing what went INTO the hash makes a registry
-- migration a re-derivation instead of a re-ingest. Decision 78.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS audience_id INTEGER;
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS hash_inputs JSONB;

-- ADD CONSTRAINT has no IF NOT EXISTS; guard it by name.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_obligations_audience'
  ) THEN
    ALTER TABLE obligations
      ADD CONSTRAINT fk_obligations_audience
      FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · rule_assertions — the append-only event log (Step 15a)
--
-- Filing does not mutate the graph. It appends "document D asserts rule R,
-- effective E, verdict V". The live graph is a PROJECTION: replay in
-- effective-date order. This is Layer C's rule — recompute, never edit — applied
-- one level up, and it is what makes a retroactive circular and a late-resolved
-- citation (16b) cheap instead of a history rewrite.
--
-- A correction is a NEW ROW pointing at the one it corrects. Nothing is ever
-- updated in place, which is why the append-only trigger below can be absolute.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rule_assertions (
  seq            BIGSERIAL PRIMARY KEY,
  doc_id         TEXT NOT NULL,
  clause_id      INTEGER REFERENCES source_clauses(id) ON DELETE SET NULL,
  obligation_id  INTEGER REFERENCES obligations(id) ON DELETE SET NULL,
  audience_id    INTEGER REFERENCES audiences(id) ON DELETE SET NULL,
  identity_hash  TEXT,
  full_hash      TEXT,
  verdict        TEXT NOT NULL,   -- restatement|amendment|new|repeal|ambiguous
  lane           TEXT,            -- fingerprint|citation|fuzzy — which lane decided
  effective_from DATE NOT NULL,   -- replay order. NOT the ingestion date.
  payload        JSONB NOT NULL DEFAULT '{}',  -- the rule exactly as asserted
  corrects_seq   BIGINT REFERENCES rule_assertions(seq) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, enforced by the database rather than by convention. The whole
-- audit story ("what did we believe on 12 March?") depends on this log being
-- immutable; a well-meaning UPDATE would silently destroy the answer.
CREATE OR REPLACE FUNCTION rule_assertions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'rule_assertions is append-only (attempted %). Append a correcting row with corrects_seq instead.',
    TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rule_assertions_append_only ON rule_assertions;
CREATE TRIGGER trg_rule_assertions_append_only
  BEFORE UPDATE OR DELETE ON rule_assertions
  FOR EACH ROW EXECUTE FUNCTION rule_assertions_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · unresolved_citations — the retry queue Step 16b sweeps
--
-- A 2024 circular cites a 2019 one that is not ingested yet. Park it here; when
-- the 2019 document lands, the sweep asks "who was waiting for me?".
--
-- target_container exists because of a B3 finding: CSCRF's numbering restarts in
-- every annexure, so `1` appears 152 times. A citation keyed on clause number
-- alone is ambiguous — it must carry the container.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unresolved_citations (
  id                 SERIAL PRIMARY KEY,
  from_clause_id     INTEGER REFERENCES source_clauses(id) ON DELETE CASCADE,
  from_obligation_id INTEGER REFERENCES obligations(id) ON DELETE CASCADE,
  raw_text           TEXT NOT NULL,   -- the citation exactly as written
  target_doc         TEXT,            -- parsed circular number, if any
  target_container   TEXT,            -- annexure/chapter — see above
  target_clause_no   TEXT,
  edge_type          TEXT,            -- depends_on|amends|supersedes
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,
  state              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|RESOLVED|ABANDONED
  resolved_edge_id   INTEGER REFERENCES edges(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · edges — provenance (Step 16c)
--
-- `from_id · to_id · type · created_at` cannot be explained to an auditor. 16c
-- names three missing pieces, not one: which citation produced the edge, how
-- confident the resolution was, and whether it is accepted or awaiting review.
-- An `amends` edge resolved ambiguously must NOT read as an accepted fact.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE edges ADD COLUMN IF NOT EXISTS source_citation JSONB;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'ACTIVE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · source_clauses.is_title / title_text (task B2)
--
-- B2 extracts the subject line ("Master Circular for Stock Brokers") — Pattern
-- C's primary input — but it lives only in the /parse-pdf response and is
-- dropped on persist. D1 reads it from here.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE source_clauses ADD COLUMN IF NOT EXISTS is_title BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE source_clauses ADD COLUMN IF NOT EXISTS title_text TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_obligations_audience        ON obligations (audience_id);
CREATE INDEX IF NOT EXISTS idx_audience_edges_broader      ON audience_edges (broader_id);

-- Replay is "read the log in effective-date order", so that is the shape of the
-- index; the identity index serves Lane 1's lookup against the log.
CREATE INDEX IF NOT EXISTS idx_rule_assertions_replay      ON rule_assertions (effective_from, seq);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_identity    ON rule_assertions (identity_hash);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_doc         ON rule_assertions (doc_id);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_obligation  ON rule_assertions (obligation_id);

-- The sweep only ever looks for PENDING rows, so the index only indexes those.
CREATE INDEX IF NOT EXISTS idx_unresolved_citations_pending
  ON unresolved_citations (target_doc) WHERE state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_edges_state                 ON edges (state);
CREATE INDEX IF NOT EXISTS idx_source_clauses_title        ON source_clauses (doc_id) WHERE is_title;

COMMIT;

DO $$ BEGIN RAISE NOTICE 'Setu alter-001: Steps 14/15/16 schema applied'; END $$;
