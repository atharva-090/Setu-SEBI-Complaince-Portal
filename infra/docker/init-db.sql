-- Setu — database init (runs once on first postgres start, on an empty volume).
-- To re-apply after edits: `docker compose down -v` then `docker compose up -d`.
--
-- Layers (see scope §4):
--   GLOBAL    (SEBI-owned, one copy): source_clauses, attributes, obligations,
--             obligation_versions, edges
--   PER-TENANT (each intermediary):  tenants, facts, evaluations, evidence
--   PLATFORM:                        users, audit_log, ingestion_runs, cache

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Embedding dimension matches the default model (text-embedding-3-small = 1536).
-- If you swap embedding models with a different dim, recreate the volume.

-- ─────────────────────────────────────────────────────────────────────────────
-- GLOBAL — the canonical regulatory graph
-- ─────────────────────────────────────────────────────────────────────────────

-- 4.1 source_clauses — the parsed clause tree
CREATE TABLE IF NOT EXISTS source_clauses (
  id          SERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  clause_no   TEXT,
  heading     TEXT,
  parent_id   INTEGER REFERENCES source_clauses(id) ON DELETE SET NULL,
  page        INTEGER,
  char_start  INTEGER,
  char_end    INTEGER,
  text        TEXT NOT NULL,
  is_title    BOOLEAN NOT NULL DEFAULT false,   -- carries the document subject line
  title_text  TEXT,                             -- "Master Circular for Stock Brokers"
  audience_id INTEGER,                          -- FK added below: audiences is
  audience_source TEXT,                         -- declared later in this file
  embedding   vector(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.2 attributes — the canonical data dictionary (registry)
CREATE TABLE IF NOT EXISTS attributes (
  id             SERIAL PRIMARY KEY,
  category       TEXT NOT NULL,                 -- context bucket / false-merge guard
  canonical_name TEXT NOT NULL,
  data_type      TEXT NOT NULL,                 -- date|number|boolean|string|document
  unit           TEXT,
  description    TEXT NOT NULL,                 -- the meaning; embedded for resolution
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  embedding      vector(1536),
  created_from   TEXT,                          -- provenance: doc#clause
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.2b audiences — the applicability layer (Step 10)
-- An audience is a SET OF FIRMS, so it is matched by its normalised test
-- character-for-character (predicate_hash), never by name similarity.
CREATE TABLE IF NOT EXISTS audiences (
  id             SERIAL PRIMARY KEY,
  label          TEXT NOT NULL,
  predicate      TEXT NOT NULL,                 -- category=='stock_broker' && is_qsb==true
  predicate_hash TEXT NOT NULL UNIQUE,          -- rung 3: exact match on the TEST
  properties     TEXT[] NOT NULL DEFAULT '{}',
  aliases        TEXT[] NOT NULL DEFAULT '{}',  -- headings that resolved here
  pattern        TEXT,                          -- C|A|B
  created_from   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Step 10e: creating an audience needs a human click. A wrongly created
  -- audience splits one group into two branches, and nothing downstream can
  -- detect it because both branches look valid.
  state           TEXT NOT NULL DEFAULT 'PROPOSED',   -- PROPOSED|APPROVED
  confidence      REAL,
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  -- Ladder rungs 5/6: meaning similarity when the exact rungs miss.
  embedding       vector(1536),
  embedded_text   TEXT
);

-- The lattice is a DAG, not a tree: one audience can be narrower than several.
CREATE TABLE IF NOT EXISTS audience_edges (
  narrower_id INTEGER NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  broader_id  INTEGER NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  derivation  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (narrower_id, broader_id),
  CHECK (narrower_id <> broader_id)
);

-- 4.3 obligations — the stored, executable rule
CREATE TABLE IF NOT EXISTS obligations (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  rule_expression TEXT NOT NULL,
  result_pass     TEXT,
  result_fail     TEXT,
  attribute_ids   INTEGER[] NOT NULL DEFAULT '{}',
  obligation_type TEXT NOT NULL DEFAULT 'computable',  -- computable|attestable
  context         TEXT,
  audience_id     INTEGER CONSTRAINT fk_obligations_audience
                          REFERENCES audiences(id) ON DELETE SET NULL,
  -- Which clause produced this rule (Step 16). A citation names a CLAUSE and an
  -- edge joins RULES; this is the map between them. SET NULL, not CASCADE: a
  -- re-ingest replaces clause rows and the rule must survive it.
  source_clause_id INTEGER CONSTRAINT fk_obligations_source_clause
                          REFERENCES source_clauses(id) ON DELETE SET NULL,
  identity_hash   TEXT,                          -- audience + attribute ids + masked shape
  full_hash       TEXT,                          -- identity + literal values
  hash_inputs     JSONB,                         -- what went into the hashes (recomputable)
  source_spans    JSONB NOT NULL DEFAULT '[]',
  version         INTEGER NOT NULL DEFAULT 1,
  state           TEXT NOT NULL DEFAULT 'ACTIVE', -- PROPOSED|ACTIVE|REVIEW|SUPERSEDED
  confidence      REAL,
  embedding       vector(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- formulas — Step 13a. A definition is not a rule: it says how one fact is
-- COMPUTED from others, and `attributes.is_derived` is what stops the intake
-- form asking a firm for a number it should be calculating.
CREATE TABLE IF NOT EXISTS formulas (
  id            SERIAL PRIMARY KEY,
  attribute_id  INTEGER NOT NULL UNIQUE REFERENCES attributes(id) ON DELETE CASCADE,
  expression    TEXT NOT NULL,
  input_ids     INTEGER[] NOT NULL DEFAULT '{}',
  source_doc    TEXT,
  source_clause TEXT,
  confidence    REAL,
  state         TEXT NOT NULL DEFAULT 'REVIEW',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- obligation_versions — lineage
CREATE TABLE IF NOT EXISTS obligation_versions (
  id                SERIAL PRIMARY KEY,
  obligation_id     INTEGER NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to          TIMESTAMPTZ,
  superseded_reason TEXT,
  snapshot          JSONB,                       -- obligation state at this version (for diffing)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- edges — relationships between obligations
CREATE TABLE IF NOT EXISTS edges (
  id         SERIAL PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                      -- amends|supersedes|split_of|depends_on|shared_evidence
  source_citation JSONB,                         -- citing clause + span: why this edge exists
  confidence REAL,
  state      TEXT NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE|REVIEW
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rule_assertions — the append-only event log (Step 15a). Filing appends
-- "document D asserts rule R, effective E, verdict V"; the live graph is a
-- projection replayed in effective-date order.
CREATE TABLE IF NOT EXISTS rule_assertions (
  seq            BIGSERIAL PRIMARY KEY,
  doc_id         TEXT NOT NULL,
  -- Plain references, deliberately NOT foreign keys. This table is append-only
  -- (see the trigger below) and a cascading SET NULL is an UPDATE, so a FK here
  -- makes deleting any referenced obligation fail — which every re-ingest does.
  -- The log records what was believed at the time and must outlive the
  -- projection it produced. See alter-003.sql.
  clause_id      INTEGER,
  obligation_id  INTEGER,
  audience_id    INTEGER,
  identity_hash  TEXT,
  full_hash      TEXT,
  verdict        TEXT NOT NULL,   -- restatement|amendment|new|repeal|ambiguous
  lane           TEXT,            -- fingerprint|citation|fuzzy
  effective_from DATE NOT NULL,   -- replay order. NOT the ingestion date.
  payload        JSONB NOT NULL DEFAULT '{}',
  corrects_seq   BIGINT REFERENCES rule_assertions(seq) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION rule_assertions_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION
    'rule_assertions is append-only (attempted %). Append a correcting row with corrects_seq instead.',
    TG_OP;
END $fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rule_assertions_append_only ON rule_assertions;
CREATE TRIGGER trg_rule_assertions_append_only
  BEFORE UPDATE OR DELETE ON rule_assertions
  FOR EACH ROW EXECUTE FUNCTION rule_assertions_append_only();

-- unresolved_citations — the retry queue Step 16b sweeps. target_container is
-- required because CSCRF numbering restarts per annexure ("1" appears 152x).
CREATE TABLE IF NOT EXISTS unresolved_citations (
  id                 SERIAL PRIMARY KEY,
  from_clause_id     INTEGER REFERENCES source_clauses(id) ON DELETE CASCADE,
  from_obligation_id INTEGER REFERENCES obligations(id) ON DELETE CASCADE,
  raw_text           TEXT NOT NULL,
  target_doc         TEXT,
  target_container   TEXT,
  target_clause_no   TEXT,
  edge_type          TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,
  state              TEXT NOT NULL DEFAULT 'PENDING',
  resolved_edge_id   INTEGER REFERENCES edges(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PER-TENANT — each intermediary's compliance state
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,                       -- stock_broker|investment_adviser
  profile    JSONB NOT NULL DEFAULT '{}',         -- is_qsb, holds_client_funds, …
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facts (
  id           SERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value        TEXT,                              -- typed by attribute.data_type
  source       TEXT,                              -- manual_entry, import, …
  entered_by   UUID,
  entered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, attribute_id)                -- one current fact per data-point per tenant
);

CREATE TABLE IF NOT EXISTS evaluations (
  id            SERIAL PRIMARY KEY,
  obligation_id INTEGER NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,                    -- GREEN|RED|GREY|AMBER
  reason        TEXT,
  method        TEXT,                             -- rule_exec|evidence_check
  computed      JSONB,                            -- the math, kept as evidence
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id           SERIAL PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  file_ref     TEXT,                              -- Mongo object id
  valid_from   DATE,
  valid_to     DATE,
  status       TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLATFORM
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,                    -- sebi_admin|intermediary
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,  -- null for sebi_admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq        BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  actor      TEXT,
  before     JSONB,
  after      JSONB,
  clause_refs JSONB,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash  TEXT,
  row_hash   TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_id      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  stages      JSONB NOT NULL DEFAULT '{}',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error       TEXT
);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  namespace  TEXT,
  value      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- source_clauses is declared before audiences (it is the first table in the
-- file), so its FK is added here, once both tables exist.
ALTER TABLE source_clauses
  ADD CONSTRAINT fk_source_clauses_audience
  FOREIGN KEY (audience_id) REFERENCES audiences(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- pgvector HNSW (cosine) on the two meaning-search columns
CREATE INDEX IF NOT EXISTS idx_attributes_embedding_hnsw
  ON attributes USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_obligations_embedding_hnsw
  ON obligations USING hnsw (embedding vector_cosine_ops);

-- attribute resolution lanes
CREATE INDEX IF NOT EXISTS idx_formulas_attribute        ON formulas (attribute_id);
CREATE INDEX IF NOT EXISTS idx_attributes_derived        ON attributes (is_derived) WHERE is_derived;
CREATE INDEX IF NOT EXISTS idx_attributes_canonical_name ON attributes (canonical_name);
CREATE INDEX IF NOT EXISTS idx_attributes_aliases_gin     ON attributes USING gin (aliases);

-- obligation matching + cascade
CREATE INDEX IF NOT EXISTS idx_obligations_identity_hash  ON obligations (identity_hash);
CREATE INDEX IF NOT EXISTS idx_obligations_attribute_ids  ON obligations USING gin (attribute_ids);
CREATE INDEX IF NOT EXISTS idx_obligations_state          ON obligations (state);

-- graph + per-tenant lookups
CREATE INDEX IF NOT EXISTS idx_edges_from_id      ON edges (from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_id        ON edges (to_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_tenant ON evaluations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_facts_tenant       ON facts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_source_clauses_doc ON source_clauses (doc_id);

-- applicability layer + filing log + citation queue (Steps 10, 15, 16)
CREATE INDEX IF NOT EXISTS idx_obligations_audience       ON obligations (audience_id);
CREATE INDEX IF NOT EXISTS idx_audience_edges_broader     ON audience_edges (broader_id);
CREATE INDEX IF NOT EXISTS idx_audiences_state            ON audiences (state);
CREATE INDEX IF NOT EXISTS idx_audiences_embedding_hnsw   ON audiences USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_replay     ON rule_assertions (effective_from, seq);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_identity   ON rule_assertions (identity_hash);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_doc        ON rule_assertions (doc_id);
CREATE INDEX IF NOT EXISTS idx_rule_assertions_obligation ON rule_assertions (obligation_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_citations_pending
  ON unresolved_citations (target_doc) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_edges_state                ON edges (state);
CREATE INDEX IF NOT EXISTS idx_obligations_source_clause  ON obligations (source_clause_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_citations_target
  ON unresolved_citations (target_clause_no, target_container) WHERE state = 'PENDING';
-- An edge is a fact about a PAIR; a re-ingest must not duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_edges_from_to_type   ON edges (from_id, to_id, type);
CREATE INDEX IF NOT EXISTS idx_source_clauses_title       ON source_clauses (doc_id) WHERE is_title;
CREATE INDEX IF NOT EXISTS idx_source_clauses_audience     ON source_clauses (audience_id);

DO $$ BEGIN RAISE NOTICE 'Setu init-db: schema + indexes ready'; END $$;
