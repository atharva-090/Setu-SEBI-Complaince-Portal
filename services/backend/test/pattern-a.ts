/**
 * D2 — Step 10b, Pattern A chapter scoping (run: `npm run test:pattern-a`).
 *
 * Two things are under test and they are separable, so they are separated:
 *
 *   1. the WALK   — which headings get sent, in what order, and where the
 *                   answers land on the tree (pattern-a.engine.ts, pure)
 *   2. the LADDER — that a chapter audience nests under the document floor in
 *                   the lattice rather than sitting beside it
 *                   (audience-resolver.service.ts, driven through a fake store)
 *
 * The tree used throughout is the master circular's real shape: a document-wide
 * floor of "all stock brokers", section 18 scoping QSBs, and a subsection under
 * it that names QSBs again.
 */

import 'reflect-metadata';
import {
  AudienceRecord,
  AudienceStore,
  AudienceResolverService,
  compare,
  conditionsOf,
} from '../src/ingestion/audience-resolver.service';
import {
  HeadingClause,
  headingLevels,
  nearestResolved,
  openingFor,
  stampTree,
} from '../src/ingestion/pattern-a.engine';

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

function section(t: string) {
  console.log(`\n${t}`);
}

// ── the fixture tree — the master circular's real shape ─────────────────────
//
//   1  (root)
//   2   17  Cyber security                              topic
//   3   18  Enhanced obligations ... Qualified Stock Brokers   AUDIENCE
//   4     18.4  Parameters for designating a broker as QSB
//   5     18.5  Enhanced obligations ... for QSBs:              AUDIENCE (same set)
//   6       18.5.1  ...rule...
//   7   19  Client funds                                 AUDIENCE (different axis)
//
const TREE: HeadingClause[] = [
  { idx: 1, parentIdx: null, depth: 0, heading: null, clauseNo: null, text: 'Master Circular' },
  { idx: 2, parentIdx: 1, depth: 1, heading: 'Cyber security and cyber resilience', clauseNo: '17', text: 'Brokers shall...' },
  { idx: 3, parentIdx: 1, depth: 1, heading: 'Enhanced obligations and responsibilities on Qualified Stock Brokers', clauseNo: '18', text: 'This chapter applies to QSBs.' },
  { idx: 4, parentIdx: 3, depth: 2, heading: 'Parameters for designating a stock broker as QSB', clauseNo: '18.4', text: 'The parameters are...' },
  { idx: 5, parentIdx: 3, depth: 2, heading: 'Enhanced obligations and responsibilities for QSBs', clauseNo: '18.5', text: 'QSBs shall...' },
  { idx: 6, parentIdx: 5, depth: 3, heading: null, clauseNo: '18.5.1', text: 'A QSB shall appoint...' },
  { idx: 7, parentIdx: 1, depth: 1, heading: 'Handling of Client Funds and Securities', clauseNo: '19', text: 'Brokers holding client money...' },
  // a running header repeating the chapter title — not a second chapter
  { idx: 8, parentIdx: 1, depth: 1, heading: 'ENHANCED OBLIGATIONS AND RESPONSIBILITIES ON QUALIFIED STOCK BROKERS', clauseNo: null, text: '' },
];

/** An in-memory audience register, so the ladder runs without a database. */
function fakeStore(): AudienceStore & { rows: AudienceRecord[]; edges: [number, number][] } {
  const rows: AudienceRecord[] = [];
  const edges: [number, number][] = [];
  let nextId = 1;
  return {
    rows,
    edges,
    findByHash: async (hash) => rows.find((r) => r.predicateHash === hash) ?? null,
    all: async () => rows,
    create: async (row) => {
      const created: AudienceRecord = {
        id: nextId++,
        label: row.label,
        predicate: row.predicate,
        predicateHash: row.predicateHash,
        properties: row.properties,
        aliases: row.aliases ?? [],
      } as AudienceRecord;
      rows.push(created);
      return created;
    },
    addAlias: async (id, alias) => {
      const row = rows.find((r) => r.id === id);
      if (row && alias && !row.aliases.includes(alias)) row.aliases.push(alias);
    },
    link: async (narrowerId, broaderId) => {
      if (!edges.some(([n, b]) => n === narrowerId && b === broaderId)) {
        edges.push([narrowerId, broaderId]);
      }
    },
  };
}

async function main() {
  // ── 1 · the walk ──────────────────────────────────────────────────────────
  section('the walk · which headings are sent, and in what order');

  const levels = headingLevels(TREE);
  check(
    'headings are grouped by depth, shallowest first',
    levels.length === 2 && levels[0].every((h) => h.idx < 4 || h.idx === 7 || h.idx === 8),
    JSON.stringify(levels.map((l) => l.map((h) => h.idx))),
  );
  check(
    'a child heading is NOT classified before its parent',
    levels[0].some((h) => h.idx === 3) && levels[1].some((h) => h.idx === 5),
    'otherwise "18.5 ... for QSBs" is composed against "all stock brokers"',
  );
  check(
    'a repeated heading is classified once',
    levels.flat().filter((h) => /qualified stock brokers$/i.test(h.heading)).length === 1,
    'a running header carries the chapter title; it is not a second chapter',
  );
  check(
    'a clause with no heading is never sent',
    !levels.flat().some((h) => h.idx === 6),
  );
  check(
    'every candidate carries its ancestry trail',
    levels[1].find((h) => h.idx === 5)?.ancestry.includes(
      'Enhanced obligations and responsibilities on Qualified Stock Brokers',
    ) === true,
    JSON.stringify(levels[1].find((h) => h.idx === 5)?.ancestry),
  );

  const childrenOf = new Map<number | null, HeadingClause[]>();
  for (const c of TREE) {
    const list = childrenOf.get(c.parentIdx) ?? [];
    list.push(c);
    childrenOf.set(c.parentIdx, list);
  }
  const opening = openingFor(TREE[2], childrenOf);
  check(
    'the opening lines are the section\'s own prose plus a little of its children',
    opening.startsWith('This chapter applies to QSBs.') && opening.includes('The parameters'),
    opening.slice(0, 80),
  );
  check(
    'the opening does NOT swallow the whole subtree',
    !opening.includes('A QSB shall appoint'),
    'later clauses describe duties, not who owes them',
  );

  // ── 2 · inheritance ───────────────────────────────────────────────────────
  section('10f · the tree inherits — one heading covers everything beneath it');

  const audienceAt = new Map<number, number>([[3, 42]]);
  const stamped = stampTree(TREE, audienceAt);
  check('the heading itself carries its audience', stamped.get(3) === 42);
  check('a direct child inherits', stamped.get(4) === 42 && stamped.get(5) === 42);
  check('a grandchild inherits', stamped.get(6) === 42, 'this is what makes the step cheap');
  check('a sibling chapter does NOT inherit', stamped.get(2) === undefined && stamped.get(7) === undefined);
  check(
    'a clause outside every audience heading keeps the document floor',
    stamped.get(1) === undefined,
    'the floor is why no clause is ever left unaddressed',
  );

  const nested = stampTree(TREE, new Map([[3, 42], [5, 99]]));
  check(
    'the NEAREST resolved ancestor wins, not the outermost',
    nested.get(6) === 99 && nested.get(4) === 42,
    JSON.stringify([...nested]),
  );
  check(
    'nearestResolved skips ancestors that resolved to nothing',
    nearestResolved(6, TREE, new Map([[3, true]])) === 3,
  );

  // ── 3 · the ladder and the lattice ────────────────────────────────────────
  section('the ladder · a chapter audience NESTS under the document floor');

  const store = fakeStore();
  const resolver = new AudienceResolverService(
    null as never,
    null as never,
    null as never,
  );

  const floor = await resolver.resolve(
    {
      label: 'Stock Brokers',
      predicate: "category == 'stock_broker'",
      predicateHash: 'hash-floor',
      conditions: ["category == 'stock_broker'"],
      properties: ['category'],
      confidence: 0.9,
      pattern: 'C',
    },
    store,
  );
  check('the document floor is created', floor.rung === 'created' && store.rows.length === 1);

  const chapter = await resolver.resolve(
    {
      label: 'Qualified Stock Brokers',
      predicate: "category == 'stock_broker' && is_qsb == true",
      predicateHash: 'hash-qsb',
      conditions: ["category == 'stock_broker'", 'is_qsb == true'],
      properties: ['category', 'is_qsb'],
      confidence: 0.9,
      pattern: 'A',
    },
    store,
  );
  check(
    'the chapter audience is NARROWER than the floor',
    chapter.rung === 'created' && chapter.narrowerThan.includes(floor.audience.id),
    JSON.stringify(chapter),
  );
  check(
    'the lattice records the containment',
    store.edges.some(([n, b]) => n === chapter.audience.id && b === floor.audience.id),
    JSON.stringify(store.edges),
  );
  check(
    'and the containment is provable, not guessed',
    compare(
      ["category == 'stock_broker'", 'is_qsb == true'],
      ["category == 'stock_broker'"],
    ) === 'narrower',
  );

  // The subsection heading composes to the SAME set. Rung 3 must collapse it.
  const again = await resolver.resolve(
    {
      label: 'Enhanced obligations for QSBs',
      predicate: "category == 'stock_broker' && is_qsb == true",
      predicateHash: 'hash-qsb',
      conditions: ["category == 'stock_broker'", 'is_qsb == true'],
      properties: ['category', 'is_qsb'],
      confidence: 0.9,
      pattern: 'A',
    },
    store,
  );
  check(
    'a second heading naming the same set REUSES the audience (rung 3)',
    again.rung === 'exact' && again.audience.id === chapter.audience.id && store.rows.length === 2,
    `${again.rung}, ${store.rows.length} audiences`,
  );
  check(
    'and the new wording is kept as an alias',
    store.rows[1].aliases.includes('Enhanced obligations for QSBs'),
    JSON.stringify(store.rows[1].aliases),
  );

  // A second axis: client funds. Narrower than the floor, unrelated to QSBs.
  const funds = await resolver.resolve(
    {
      label: 'Brokers holding client funds',
      predicate: "category == 'stock_broker' && holds_client_funds == true",
      predicateHash: 'hash-funds',
      conditions: ["category == 'stock_broker'", 'holds_client_funds == true'],
      properties: ['category', 'holds_client_funds'],
      confidence: 0.9,
      pattern: 'A',
    },
    store,
  );
  check(
    'a second chapter audience also nests under the floor',
    funds.narrowerThan.includes(floor.audience.id),
  );
  check(
    'two chapter audiences on different axes are UNRELATED to each other',
    compare(
      ["category == 'stock_broker'", 'is_qsb == true'],
      ["category == 'stock_broker'", 'holds_client_funds == true'],
    ) === 'unrelated',
    'a firm can be both; neither implies the other',
  );

  // The lattice is a DAG, not a tree: a node can sit under two parents.
  const both = await resolver.resolve(
    {
      label: 'QSBs holding client funds',
      predicate: "category == 'stock_broker' && holds_client_funds == true && is_qsb == true",
      predicateHash: 'hash-both',
      conditions: [
        "category == 'stock_broker'",
        'holds_client_funds == true',
        'is_qsb == true',
      ],
      properties: ['category', 'holds_client_funds', 'is_qsb'],
      confidence: 0.9,
      pattern: 'A',
    },
    store,
  );
  check(
    'an audience narrowing two axes sits under BOTH parents — a lattice, not a tree',
    both.narrowerThan.includes(chapter.audience.id) &&
      both.narrowerThan.includes(funds.audience.id) &&
      both.narrowerThan.includes(floor.audience.id),
    JSON.stringify(both.narrowerThan),
  );
  check(
    'a tree would have forced one parent and duplicated the rules down both branches',
    store.edges.filter(([n]) => n === both.audience.id).length === 3,
    JSON.stringify(store.edges.filter(([n]) => n === both.audience.id)),
  );

  // ── 4 · the acceptance line ───────────────────────────────────────────────
  section('acceptance');
  check(
    'a chapter-scoped heading yields a narrower audience than its document floor',
    compare(conditionsOf(chapter.audience.predicate), conditionsOf(floor.audience.predicate)) ===
      'narrower',
    `${chapter.audience.predicate}  ⊂  ${floor.audience.predicate}`,
  );
  check(
    'and the lattice records the containment',
    store.edges.some(([n, b]) => n === chapter.audience.id && b === floor.audience.id),
  );

  console.log('');
  if (failures.length) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed:`);
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log(`PASSED — all ${passed} assertions green.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
