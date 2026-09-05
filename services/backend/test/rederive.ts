/**
 * Re-derive stored fingerprints (run inside the backend container).
 *
 *     docker compose run --rm --no-deps -e DB_HOST=postgres backend \
 *       npx ts-node --transpile-only test/rederive.ts [--apply]
 *
 * This exists because D4 changed how a fingerprint is computed: time literals are
 * now normalised to days for comparison, and the time functions collapse to one
 * name in the masked shape, so "every 6 months" and "every 180 days" stop being
 * two obligations.
 *
 * Decision 78 promised that such a change would be a RE-DERIVATION rather than a
 * re-ingest — that is why `hash_inputs` stores what went into the hash. This is
 * the script that makes the promise true. Without it, 490 stored rules would
 * carry hashes computed by the old rules, and the next ingest of their document
 * would file every one of them as a NEW obligation: an amendment storm caused by
 * us, not by SEBI.
 *
 * Dry by default. `--apply` writes.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const AI = process.env.AI_SERVICE_URL ?? 'http://ai-service:8000';
const KEY = process.env.AI_SERVICE_KEY ?? '';
const APPLY = process.argv.includes('--apply');
const BATCH = 200;

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'setu_user',
    password: process.env.DB_PASSWORD ?? 'setu_pass',
    database: process.env.DB_NAME ?? 'setu_db',
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });
  await ds.initialize();

  // Only rules that HAVE a stored derivation. A rule without hash_inputs cannot
  // be re-derived and must not be silently re-guessed.
  const rows: {
    id: number;
    rule_expression: string;
    audience_id: number | null;
    identity_hash: string | null;
    full_hash: string | null;
    hash_inputs: { ref_ids?: Record<string, number> } | null;
  }[] = await ds.query(
    `SELECT id, rule_expression, audience_id, identity_hash, full_hash, hash_inputs
       FROM obligations
      WHERE hash_inputs IS NOT NULL AND rule_expression <> ''
      ORDER BY id`,
  );

  console.log(`${rows.length} rules carry a stored derivation`);

  let changed = 0;
  let identityChanged = 0;
  let failed = 0;
  const samples: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${AI}/fingerprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI-Key': KEY },
      body: JSON.stringify({
        items: batch.map((r) => ({
          key: String(r.id),
          expression: r.rule_expression,
          audience_id: r.audience_id,
          // The stored ref ids, not a fresh resolution: re-deriving must not
          // quietly re-run the attribute funnel and change what the rule means.
          attribute_ids: r.hash_inputs?.ref_ids ?? {},
        })),
      }),
    });
    if (!res.ok) {
      console.error(`fingerprint batch failed: ${res.status} ${await res.text()}`);
      failed += batch.length;
      continue;
    }
    const body = (await res.json()) as {
      results: {
        key: string;
        identity_hash: string | null;
        full_hash: string | null;
        error: string | null;
      }[];
    };
    for (const fp of body.results) {
      const row = batch.find((r) => String(r.id) === fp.key);
      if (!row) continue;
      if (fp.error || !fp.identity_hash) {
        failed += 1;
        continue;
      }
      const idMoved = fp.identity_hash !== row.identity_hash;
      const fullMoved = fp.full_hash !== row.full_hash;
      if (!idMoved && !fullMoved) continue;
      changed += 1;
      if (idMoved) identityChanged += 1;
      if (samples.length < 8) {
        samples.push(
          `  ${row.id}  ${row.rule_expression.slice(0, 54)}\n` +
            `        identity ${(row.identity_hash ?? '-').slice(0, 12)} -> ${fp.identity_hash.slice(0, 12)}` +
            `${idMoved ? '  MOVED' : ''}`,
        );
      }
      if (APPLY) {
        await ds.query(
          `UPDATE obligations SET identity_hash = $2, full_hash = $3, updated_at = now()
            WHERE id = $1`,
          [row.id, fp.identity_hash, fp.full_hash],
        );
      }
    }
  }

  console.log('');
  console.log(`re-derived   ${changed} rules would change (${identityChanged} identity)`);
  console.log(`unchanged    ${rows.length - changed - failed}`);
  console.log(`not derivable ${failed}`);
  if (samples.length) {
    console.log('\nsamples:');
    samples.forEach((s) => console.log(s));
  }
  console.log(
    APPLY
      ? '\nAPPLIED — the graph now agrees with the current fingerprint rules.'
      : '\nDRY RUN — pass --apply to write.',
  );
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
