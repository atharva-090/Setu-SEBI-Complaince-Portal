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
  identity_hash   TEXT,                          -- SHA-256 of (context+action+roles), value excluded
  full_hash       TEXT,                          -- identity + literal values
  source_spans    JSONB NOT NULL DEFAULT '[]',
  version         INTEGER NOT NULL DEFAULT 1,
  state           TEXT NOT NULL DEFAULT 'ACTIVE', -- PROPOSED|ACTIVE|REVIEW|SUPERSEDED
  confidence      REAL,
  embedding       vector(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- pgvector HNSW (cosine) on the two meaning-search columns
CREATE INDEX IF NOT EXISTS idx_attributes_embedding_hnsw
  ON attributes USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_obligations_embedding_hnsw
  ON obligations USING hnsw (embedding vector_cosine_ops);

-- attribute resolution lanes
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

DO $$ BEGIN RAISE NOTICE 'Setu init-db: schema + indexes ready'; END $$;
