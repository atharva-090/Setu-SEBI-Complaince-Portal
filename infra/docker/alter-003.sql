-- Setu — alter-003: the event log must not be cascaded by its own projection.
--
-- THE BUG THIS FIXES
--   alter-001 gave rule_assertions foreign keys to obligations, source_clauses
--   and audiences, all ON DELETE SET NULL. But rule_assertions is append-only,
--   enforced by a trigger that rejects UPDATE. A cascading SET NULL *is* an
--   UPDATE, so:
--
--     DELETE FROM obligations WHERE id = 42;
--     ERROR: rule_assertions is append-only (attempted UPDATE).
--
--   Re-ingesting a document deletes its obligations first. Every re-ingest
--   would have failed the moment the first assertion existed.
--
-- WHY DROPPING THE FKs IS RIGHT, NOT A WORKAROUND
--   The log records what was believed AT THE TIME. The graph is a projection of
--   the log, recomputed and thrown away — Layer C's rule. A projection must not
--   be able to reach back and rewrite the history that produced it, so the log
--   holds plain references, not constrained ones. An obligation id in an old
--   assertion pointing at a row that no longer exists is not corruption: it is
--   the correct record of a belief that has since been re-derived.
--
-- Idempotent. Mirrored into init-db.sql.

BEGIN;

ALTER TABLE rule_assertions DROP CONSTRAINT IF EXISTS rule_assertions_obligation_id_fkey;
ALTER TABLE rule_assertions DROP CONSTRAINT IF EXISTS rule_assertions_clause_id_fkey;
ALTER TABLE rule_assertions DROP CONSTRAINT IF EXISTS rule_assertions_audience_id_fkey;

COMMENT ON COLUMN rule_assertions.obligation_id IS
  'Plain reference, deliberately not a FK: the append-only log must survive the deletion of the projection it produced (alter-003).';

COMMIT;

DO $$ BEGIN RAISE NOTICE 'Setu alter-003: event log decoupled from the projection'; END $$;
