/**
 * D1 — Pattern C and the audience ladder (run: `npm run test:pattern-c`).
 *
 * Drives the REAL AudienceResolverService against an in-memory stand-in for the
 * `audiences` table, the same way test:m3 does for attributes. No Docker, no
 * database, no API key.
 *
 * What is actually being tested is the claim the whole step rests on: an
 * audience is a SET OF FIRMS, so matching it is exact rather than fuzzy. Every
 * assertion below is a set-comparison that must come out the same way every
 * time — if any of these becomes probabilistic, Step 10 has lost its point.
 */

import 'reflect-metadata';
import {
  AudienceRecord,
  AudienceResolverService,
  AudienceStore,
  compare,
  conditionsOf,
  implies,
} from '../src/ingestion/audience-resolver.service';

// ── tiny assert harness ──────────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── in-memory `audiences` + `audience_edges` ─────────────────────────────────
class FakeStore implements AudienceStore {
  rows: AudienceRecord[] = [];
  links: { narrowerId: number; broaderId: number; derivation: string }[] = [];
  private seq = 0;

  async findByHash(hash: string) {
    return this.rows.find((r) => r.predicateHash === hash) ?? null;
  }
  async all() {
    return this.rows;
  }
  async create(row: Omit<AudienceRecord, 'id'>) {
    const created = { ...row, id: ++this.seq } as AudienceRecord;
    this.rows.push(created);
    return created;
  }
  async addAlias(id: number, alias: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row && alias && !row.aliases.includes(alias)) row.aliases.push(alias);
  }
  async link(narrowerId: number, broaderId: number, derivation: string) {
    if (this.links.some((l) => l.narrowerId === narrowerId && l.broaderId === broaderId)) return;
    this.links.push({ narrowerId, broaderId, derivation });
  }
}

/** Hash stands in for the AI service's sha256 — equal normalised text, equal key. */
const hashOf = (normalised: string) => `h:${normalised}`;

function candidate(label: string, normalised: string, confidence = 0.9) {
  const conditions = conditionsOf(normalised);
  return {
    label,
    predicate: normalised,
    predicateHash: hashOf(normalised),
    conditions,
    properties: conditions.map((c) => c.split(' ')[0]),
    confidence,
    pattern: 'C',
  };
}

async function main() {
  // The service is used for its ladder only; the repositories it would inject
  // are never touched, because every call passes the in-memory store.
  const svc = new AudienceResolverService(null as never, null as never, null as never);

  section('rung 4 — implication is computed, not guessed');
  check(
    'a narrower test implies a broader one',
    implies(
      ["category == 'stock_broker'", 'is_qsb == true'],
      ["category == 'stock_broker'"],
    ),
  );
  check(
    'a broader test does NOT imply a narrower one',
    !implies(
      ["category == 'stock_broker'"],
      ["category == 'stock_broker'", 'is_qsb == true'],
    ),
  );
  check(
    'a single category implies the set containing it',
    implies(
      ["category == 'stock_broker'"],
      ["category in ['investment_adviser', 'stock_broker']"],
    ),
  );
  check(
    'a set does not imply a member outside it',
    !implies(["category in ['stock_broker', 'custodian']"], ["category == 'custodian'"]),
  );
  check(
    'interval containment: >50000 implies >10000',
    implies(['active_clients > 50000'], ['active_clients > 10000']),
  );
  check(
    'and not the other way round',
    !implies(['active_clients > 10000'], ['active_clients > 50000']),
  );
  check(
    'unrelated tests stay unrelated',
    compare(["category == 'stock_broker'"], ["category == 'custodian'"]) === 'unrelated',
  );
  check(
    'the four outcomes are named correctly',
    compare(["category == 'stock_broker'", 'is_qsb == true'], ["category == 'stock_broker'"]) ===
      'narrower' &&
      compare(["category == 'stock_broker'"], ["category == 'stock_broker'", 'is_qsb == true']) ===
        'broader' &&
      compare(["category == 'stock_broker'"], ["category == 'stock_broker'"]) === 'identical',
  );

  section('rung 3 — the same test resolves to the same audience');
  const store = new FakeStore();
  const first = await svc.resolve(candidate('Stock Brokers', "category == 'stock_broker'"), store);
  check('first document mints the audience', first.rung === 'created', first.rung);
  const second = await svc.resolve(
    candidate('All Stock Brokers', "category == 'stock_broker'"),
    store,
  );
  check('second document REUSES it', second.rung === 'exact', second.rung);
  check('and it is the same row', second.audience.id === first.audience.id);
  check('the register did not grow', store.rows.length === 1, `rows=${store.rows.length}`);
  check(
    'the differing wording is kept as an alias',
    store.rows[0].aliases.includes('All Stock Brokers'),
    JSON.stringify(store.rows[0].aliases),
  );
  check(
    'an exact match is certain, not scored',
    second.confidence === 1 && !second.needsApproval,
  );

  section('rung 4 — a narrower audience nests instead of duplicating');
  const qsb = await svc.resolve(
    candidate('QSBs', "category == 'stock_broker' && is_qsb == true"),
    store,
  );
  check('it is a new node, not a reuse', qsb.rung === 'created');
  check('recorded as narrower than stock brokers', qsb.narrowerThan.includes(first.audience.id));
  check(
    'the containment edge exists',
    store.links.some((l) => l.narrowerId === qsb.audience.id && l.broaderId === first.audience.id),
  );

  section('the lattice is a DAG — one node, several parents');
  const advisers = await svc.resolve(
    candidate('Investment Advisers', "category == 'investment_adviser'"),
    store,
  );
  const bothSets = await svc.resolve(
    candidate(
      'Brokers and Advisers',
      "category in ['investment_adviser', 'stock_broker']",
    ),
    store,
  );
  check(
    'the set audience is BROADER than both single categories',
    bothSets.broaderThan.includes(first.audience.id) &&
      bothSets.broaderThan.includes(advisers.audience.id),
    JSON.stringify(bothSets.broaderThan),
  );
  // QSB nests under it too: is_qsb implies category=='stock_broker', which
  // implies the set. So the containment recorded is the FULL relation, not just
  // the direct parents of a Hasse diagram — three edges, not two.
  //
  // That redundancy is deliberate. D9 asks "is this rule's audience strictly
  // narrower than that one's?" and a stored transitive edge answers it with a
  // lookup instead of a recursive walk. The lattice is small (Pattern C mints
  // one node per distinct document scope), so the extra rows cost nothing.
  check(
    'and the transitively narrower QSB audience nests too',
    bothSets.broaderThan.includes(qsb.audience.id),
    JSON.stringify(bothSets.broaderThan),
  );
  check(
    'so all three nest underneath it',
    store.links.filter((l) => l.broaderId === bothSets.audience.id).length === 3,
    `links=${store.links.filter((l) => l.broaderId === bothSets.audience.id).length}`,
  );

  section('the implied-terms table (10c) collapses two spellings into one');
  // "Obligations of QSBs" at the top of one circular, and the same audience
  // under a "Stock Brokers" part in another. The AI service adds the implied
  // category during normalisation, so both arrive here identical.
  const implied = await svc.resolve(
    candidate('QSB Obligations', "category == 'stock_broker' && is_qsb == true"),
    store,
  );
  check('resolves to the existing QSB node', implied.audience.id === qsb.audience.id);
  check('no fifth node was created', store.rows.length === 4, `rows=${store.rows.length}`);

  section('rung 7 — a new audience is a human decision');
  const lowConfidence = await svc.resolve(
    candidate('Something New', "category == 'custodian'", 0.35),
    store,
  );
  check('created but flagged for approval', lowConfidence.needsApproval);
  const confident = await svc.resolve(
    candidate('Merchant Bankers', "category == 'merchant_banker'", 0.95),
    store,
  );
  check('a confident one is not flagged', !confident.needsApproval);

  section('order independence — the register does not depend on arrival order');
  const reversed = new FakeStore();
  await svc.resolve(candidate('QSBs', "category == 'stock_broker' && is_qsb == true"), reversed);
  await svc.resolve(candidate('Stock Brokers', "category == 'stock_broker'"), reversed);
  check(
    'same two nodes either way round',
    reversed.rows.length === 2,
    `rows=${reversed.rows.length}`,
  );
  check(
    'and the same containment edge, regardless of which arrived first',
    reversed.links.length === 1 &&
      reversed.links[0].narrowerId === reversed.rows[0].id &&
      reversed.links[0].broaderId === reversed.rows[1].id,
    JSON.stringify(reversed.links),
  );

  console.log('\n' + '─'.repeat(64));
  if (failures.length) {
    console.log(`FAILED — ${failures.length} of ${passed + failures.length} assertions:`);
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log(`PASSED — all ${passed} assertions green.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
