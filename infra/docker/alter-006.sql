-- ─────────────────────────────────────────────────────────────────────────────
-- alter-006 — Step 10, ladder rungs 5 and 6.
--
-- Rungs 3 (exact match) and 4 (logical implication) compare TESTS, and both are
-- exact: they need no vector at all. Rung 5 is the fallback for when the model
-- phrased the same group with a different property and neither exact rung can
-- see it -- and that needs an embedding per audience, which is why these rungs
-- were deferred until now.
--
-- D2 measured that rungs 3 and 4 settled all 24 chapter audiences on their own,
-- because composition happens in code against a fixed vocabulary. That holds
-- while the vocabulary is fixed. It stops holding the moment a real model is
-- free to name a NEW property, which is exactly what the live gpt-4o run does.
--
-- Idempotent. Mirrored into init-db.sql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audiences
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  -- What was embedded: label + the plain-English reading of the test. Kept so a
  -- re-embed with a better model is a re-derivation, not a re-resolution.
  ADD COLUMN IF NOT EXISTS embedded_text TEXT;

CREATE INDEX IF NOT EXISTS idx_audiences_embedding_hnsw
  ON audiences USING hnsw (embedding vector_cosine_ops);
