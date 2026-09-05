/**
 * C1 — schema check.
 *
 * TypeScript compiling proves nothing about whether an entity matches the
 * database: SnakeNamingStrategy maps `identityHash` to `identity_hash` at
 * RUNTIME, and `synchronize: false` means nobody ever reconciles the two. This
 * drives every new entity against the real Postgres, so a hand-written ALTER
 * that drifted from its entity fails here instead of at 2am in D7.
 *
 *   DB_HOST=localhost npx ts-node --transpile-only test/c1-schema.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import {
  ALL_ENTITIES,
  Audience,
  Edge,
  Obligation,
  RuleAssertion,
  SourceClause,
  UnresolvedCitation,
} from '../src/database/entities';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME || 'setu_user',
    password: process.env.DB_PASSWORD || 'setu_password',
    database: process.env.DB_DATABASE || 'setu_db',
    entities: ALL_ENTITIES,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });
  await ds.initialize();

  console.log('\nentity -> column mapping (every new column read from the DB)');
  // A select of the new columns fails loudly if the column does not exist under
  // the name the naming strategy derives.
  await ds.getRepository(Obligation).find({
    select: ['id', 'audienceId', 'hashInputs', 'identityHash', 'fullHash'],
    take: 1,
  });
  check('obligations.audienceId + hashInputs readable', true);

  await ds.getRepository(Edge).find({
    select: ['id', 'sourceCitation', 'confidence', 'state'],
    take: 1,
  });
  check('edges.sourceCitation + confidence + state readable', true);

  await ds.getRepository(SourceClause).find({
    select: ['id', 'isTitle', 'titleText'],
    take: 1,
  });
  check('source_clauses.isTitle + titleText readable', true);

  for (const [label, entity] of [
    ['audiences', Audience],
    ['rule_assertions', RuleAssertion],
    ['unresolved_citations', UnresolvedCitation],
  ] as const) {
    await ds.getRepository(entity as any).count();
    check(`${label} exists and is queryable`, true);
  }

  console.log('\nround trip through the entities');
  const audiences = ds.getRepository(Audience);
  const saved = await audiences.save(
    audiences.create({
      label: 'C1 probe — Qualified Stock Brokers',
      predicate: "category=='stock_broker' && is_qsb==true",
      predicateHash: `c1_probe_${Date.now()}`,
      properties: ['category', 'is_qsb'],
      aliases: ['QSB Obligations'],
      pattern: 'C',
    }),
  );
  const read = await audiences.findOneByOrFail({ id: saved.id });
  check('audience arrays survive a round trip',
    read.properties.length === 2 && read.aliases[0] === 'QSB Obligations',
    JSON.stringify({ properties: read.properties, aliases: read.aliases }));

  // predicate_hash is the exact-match key Step 10 rung 3 depends on; a duplicate
  // must be impossible, not merely discouraged.
  let duplicateRejected = false;
  try {
    await audiences.save(
      audiences.create({
        label: 'duplicate',
        predicate: 'anything',
        predicateHash: read.predicateHash,
      }),
    );
  } catch {
    duplicateRejected = true;
  }
  check('duplicate predicateHash is rejected', duplicateRejected);

  console.log('\nappend-only guarantee (Step 15a)');
  const assertions = ds.getRepository(RuleAssertion);
  const asserted = await assertions.save(
    assertions.create({
      docId: 'c1-probe-doc',
      verdict: 'new',
      lane: 'fingerprint',
      effectiveFrom: '2024-08-09',
      identityHash: 'c1_probe_identity',
      audienceId: saved.id,
      payload: { probe: true },
    }),
  );
  check('assertion appended', !!asserted.seq);

  let updateBlocked = false;
  try {
    await assertions.update({ seq: asserted.seq }, { verdict: 'amendment' });
  } catch (e) {
    updateBlocked = /append-only/i.test(String(e));
  }
  check('UPDATE on rule_assertions is rejected by the database', updateBlocked);

  let deleteBlocked = false;
  try {
    await assertions.delete({ seq: asserted.seq });
  } catch (e) {
    deleteBlocked = /append-only/i.test(String(e));
  }
  check('DELETE on rule_assertions is rejected by the database', deleteBlocked);

  const stillThere = await assertions.countBy({ docId: 'c1-probe-doc' });
  check('the assertion survived both attempts', stillThere === 1, `count=${stillThere}`);

  // Clean up. Removing a probe requires deliberately disabling the trigger,
  // which is exactly the friction the design wants around this table.
  await ds.query(
    'ALTER TABLE rule_assertions DISABLE TRIGGER trg_rule_assertions_append_only',
  );
  await ds.query(`DELETE FROM rule_assertions WHERE doc_id = 'c1-probe-doc'`);
  await ds.query(
    'ALTER TABLE rule_assertions ENABLE TRIGGER trg_rule_assertions_append_only',
  );
  await audiences.delete({ id: saved.id });

  const leftovers =
    (await assertions.countBy({ docId: 'c1-probe-doc' })) +
    (await audiences.countBy({ id: saved.id }));
  check('probes cleaned up', leftovers === 0, `leftovers=${leftovers}`);

  await ds.destroy();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nERROR', e);
  process.exit(1);
});
