/**
 * Register consolidation — Step 13's cold-start half, run over a register that
 * already exists (run inside the backend container).
 *
 *     docker compose run --rm --no-deps -e DB_HOST=postgres backend \
 *       npx ts-node --transpile-only test/consolidate.ts [--apply] [--distance 0.12]
 *
 * Dry by default. Makes no API calls: every attribute already carries the
 * embedding the funnel computed for it, so the clustering that should have
 * happened at bulk-load time is done now over exactly the same vectors.
 *
 * After --apply, fingerprints are STALE (attribute ids enter the identity hash)
 * and test/rederive.ts --apply must follow.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Attribute } from '../src/database/entities/attribute.entity';
import { Obligation } from '../src/database/entities/obligation.entity';
import { RegisterConsolidationService } from '../src/ingestion/register-consolidation.service';

const APPLY = process.argv.includes('--apply');
const distanceArg = process.argv.indexOf('--distance');
const MAX_DISTANCE = distanceArg > -1 ? Number(process.argv[distanceArg + 1]) : 0.12;

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'setu_user',
    password: process.env.DB_PASSWORD ?? 'setu_password',
    database: process.env.DB_NAME ?? 'setu_db',
    entities: [Attribute, Obligation],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });
  await ds.initialize();

  const service = new RegisterConsolidationService(
    ds.getRepository(Attribute),
    ds.getRepository(Obligation),
  );

  const plan = await service.plan({ maxDistance: MAX_DISTANCE });
  const s = plan.stats;

  console.log(`distance threshold   ${MAX_DISTANCE}`);
  console.log(`attributes           ${s.attributes} (${s.withEmbedding} with an embedding)`);
  console.log(`clusters             ${s.clusters}`);
  console.log(`merges proposed      ${s.merges}`);
  console.log(`attributes removed   ${s.attributesRemoved}`);
  console.log(`rules re-pointed     ${s.rulesRepointed}`);

  const biggest = [...plan.merges].sort((a, b) => b.dropIds.length - a.dropIds.length).slice(0, 10);
  if (biggest.length) {
    console.log('\nlargest merges:');
    for (const m of biggest) {
      console.log(`  ${m.keepName}  <-  ${m.dropNames.slice(0, 4).join(', ')}`);
      console.log(`      ${m.rationale.slice(0, 100)}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to write.');
    await ds.destroy();
    return;
  }

  const result = await service.apply(plan);
  console.log(`\nAPPLIED — ${result.removed} attributes merged, ${result.repointed} rule rows re-pointed.`);
  console.log('Fingerprints are now STALE. Run: npx ts-node --transpile-only test/rederive.ts --apply');
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
