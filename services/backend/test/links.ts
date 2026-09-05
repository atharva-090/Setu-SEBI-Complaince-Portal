/**
 * D8 — Step 16 link resolution (run: `npm run test:links`).
 *
 * Drives the REAL link engine. No Docker, no database: every claim being tested
 * is a claim about a DECISION — which clause a number points at, whether an edge
 * may be created imprecisely, whether an edge would close a cycle — and those
 * are only checkable if the decision surface is a pure function of its inputs.
 *
 * The clause tree used throughout mirrors what the corpus actually looks like:
 * a body with 9.5 / 9.5.3.1, and an annexure whose numbering restarts at 1 —
 * which is the whole reason `clause_no` is not a key (Decision 66).
 */

import 'reflect-metadata';
import {
  ClauseNode,
  ExtractedCitation,
  LinkRule,
  ProposedEdge,
  admitEdges,
  proposeEdges,
  resolveTarget,
  sharedEvidenceGroups,
  splitEdges,
  sweepCandidates,
  wouldCycle,
} from '../src/ingestion/links.engine';

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

// ── the fixture tree ────────────────────────────────────────────────────────
//
//   1  chapter 9                       (container)
//   2    9.5                           cited by amendments
//   3      9.5.3                       (container)
//   4        9.5.3.1                   the duty that gets depended on
//   5        9.5.3.2                   the clause that cites 9.5.3.1
//   6  Annexure A                      (container)
//   7    1                             ← same number as the body's "1"
//   8    2
//   9    1                             the body's "1"
//  11    1                             a second body "1" — two under one parent
//
const CLAUSES: ClauseNode[] = [
  { id: 1, clauseNo: '9', parentId: null, citable: false, container: null },
  { id: 2, clauseNo: '9.5', parentId: 1, citable: true, container: null },
  { id: 3, clauseNo: '9.5.3', parentId: 2, citable: true, container: null },
  { id: 4, clauseNo: '9.5.3.1', parentId: 3, citable: true, container: null },
  { id: 5, clauseNo: '9.5.3.2', parentId: 3, citable: true, container: null },
  { id: 6, clauseNo: null, parentId: null, citable: false, container: 'Annexure A' },
  { id: 7, clauseNo: '1', parentId: 6, citable: true, container: 'Annexure A' },
  { id: 8, clauseNo: '2', parentId: 6, citable: true, container: 'Annexure A' },
  { id: 9, clauseNo: '1', parentId: 1, citable: true, container: null },
  // a table-of-contents row carrying 9.5.3.1 — present, and not a target
  { id: 10, clauseNo: '9.5.3.1', parentId: null, citable: false, container: null },
  // a SECOND "1" under chapter 9. This is what makes a bare "1" cited from the
  // body genuinely unresolvable: scoping up to the nearest ancestor finds two,
  // and going higher can only find more.
  { id: 11, clauseNo: '1', parentId: 1, citable: true, container: null },
];

function cite(over: Partial<ExtractedCitation> = {}): ExtractedCitation {
  return {
    raw: 'para 9.5.3.1',
    cue: 'para',
    number: '9.5.3.1',
    kind: 'trigger',
    targetType: 'internal',
    targetContainer: null,
    targetDoc: null,
    charStart: 100,
    charEnd: 112,
    context: 'where unable to comply with para 9.5.3.1',
    ...over,
  };
}

async function main() {
  // ── 16a hop one: citation → clause ────────────────────────────────────────
  section('16a · a citation names a CLAUSE');

  const unique = resolveTarget(cite(), 5, CLAUSES);
  check('a number matching one citable clause resolves', unique.how === 'unique' && unique.clauseIds[0] === 4, JSON.stringify(unique));

  check(
    'a table-of-contents row is NOT a citation target',
    !unique.clauseIds.includes(10),
    'the TOC carries the same number and must not be linked',
  );

  const absent = resolveTarget(cite({ number: '77.7' }), 5, CLAUSES);
  check('a number this document does not contain is absent, not guessed', absent.how === 'absent' && absent.clauseIds.length === 0);

  const external = resolveTarget(
    cite({ targetType: 'statute', number: '7(1)', raw: 'Regulation 7(1)' }),
    5,
    CLAUSES,
  );
  check('a statute reference produces no target at all', external.how === 'external' && external.clauseIds.length === 0);

  // Decision 66 — "1" is two different clauses.
  const fromBody = resolveTarget(cite({ number: '1', raw: 'para 1' }), 9, CLAUSES);
  const fromAnnex = resolveTarget(cite({ number: '1', raw: 'para 1' }), 8, CLAUSES);
  check(
    'a bare number cited from inside the annexure scopes to the annexure',
    fromAnnex.how === 'scoped' && fromAnnex.clauseIds[0] === 7,
    JSON.stringify(fromAnnex),
  );
  check(
    'the SAME number cited from the body does not resolve to the annexure',
    !fromBody.clauseIds.includes(7) || fromBody.how === 'ambiguous',
    JSON.stringify(fromBody),
  );

  const explicit = resolveTarget(
    cite({ number: '1', raw: 'para 1 of Annexure A', targetContainer: 'Annexure A' }),
    5,
    CLAUSES,
  );
  check(
    'an explicitly stated container beats scoping',
    explicit.how === 'container' && explicit.clauseIds[0] === 7,
    JSON.stringify(explicit),
  );

  const cycleGuard = resolveTarget(
    cite({ number: '1' }),
    999, // a citing clause that is not in the tree
    CLAUSES,
  );
  check('an unknown citing clause degrades to ambiguous, it does not throw', cycleGuard.how === 'ambiguous');

  // ── 16a hop two: clause → rules, and the asymmetry ────────────────────────
  section('16a · an edge joins RULES — and the two hops fail differently');

  // clause 4 produced THREE rules; clause 5 produced one.
  const RULES: LinkRule[] = [
    { id: 41, clauseId: 4, attributeIds: [100, 200], state: 'ACTIVE' },
    { id: 42, clauseId: 4, attributeIds: [100, 200], state: 'ACTIVE' },
    { id: 43, clauseId: 4, attributeIds: [300], state: 'ACTIVE' },
    { id: 51, clauseId: 5, attributeIds: [400], state: 'ACTIVE' },
    { id: 21, clauseId: 2, attributeIds: [500], state: 'ACTIVE' },
  ];

  const trigger = proposeEdges([{ clauseId: 5, citation: cite() }], CLAUSES, RULES);
  check(
    'a conditional trigger produces depends_on edges',
    trigger.edges.length === 3 && trigger.edges.every((e) => e.type === 'depends_on'),
    JSON.stringify(trigger.edges.map((e) => `${e.fromId}->${e.toId}`)),
  );
  check(
    'depends_on FANS OUT to every rule of the cited clause',
    new Set(trigger.edges.map((e) => e.toId)).size === 3,
    'over-linking is recoverable; evaluation walks the edge and finds nothing wrong',
  );
  check(
    'the edge carries its citing clause and span — an auditor can be shown WHY',
    trigger.edges.every(
      (e) =>
        e.sourceCitation.raw === 'para 9.5.3.1' &&
        e.sourceCitation.from_clause === 5 &&
        Array.isArray(e.sourceCitation.char),
    ),
    JSON.stringify(trigger.edges[0]?.sourceCitation),
  );

  const amends = proposeEdges(
    [{ clauseId: 5, citation: cite({ kind: 'amends', raw: 'partially modifies para 9.5.3.1' }) }],
    CLAUSES,
    RULES,
  );
  check(
    'amends does NOT fan out — three rules from one clause is refused',
    amends.edges.length === 0 && amends.parked[0]?.reason === 'target_not_precise',
    JSON.stringify(amends.parked),
  );
  const amendsPrecise = proposeEdges(
    [{ clauseId: 5, citation: cite({ kind: 'amends', number: '9.5', raw: 'partially modifies para 9.5' }) }],
    CLAUSES,
    RULES,
  );
  check(
    'amends DOES file when the target is a single rule',
    amendsPrecise.edges.length === 1 && amendsPrecise.edges[0].type === 'amends' && amendsPrecise.edges[0].toId === 21,
    JSON.stringify(amendsPrecise.edges),
  );
  check(
    'but an amends edge is REVIEW even when it resolved exactly',
    amendsPrecise.edges[0].state === 'REVIEW',
    'Step 15 owns the filing verdict; an ACTIVE amends edge would assert a change the version history does not record',
  );

  const ambiguousAmend = proposeEdges(
    [{ clauseId: 5, citation: cite({ kind: 'supersedes', number: '1', raw: 'para 1 stands withdrawn' }) }],
    CLAUSES,
    [...RULES, { id: 71, clauseId: 7, attributeIds: [], state: 'ACTIVE' }, { id: 91, clauseId: 9, attributeIds: [], state: 'ACTIVE' }],
  );
  check(
    'an ambiguous supersedes is REFUSED, never auto-filed',
    ambiguousAmend.edges.length === 0 && ambiguousAmend.parked[0]?.reason === 'ambiguous',
    JSON.stringify(ambiguousAmend.parked),
  );

  const ambiguousTrigger = proposeEdges(
    [{ clauseId: 5, citation: cite({ number: '1', raw: 'unable to comply with para 1' }) }],
    CLAUSES,
    [...RULES, { id: 71, clauseId: 7, attributeIds: [], state: 'ACTIVE' }, { id: 91, clauseId: 9, attributeIds: [], state: 'ACTIVE' }],
  );
  check(
    'an ambiguous depends_on IS filed — but in REVIEW, not as accepted fact',
    ambiguousTrigger.edges.length > 0 && ambiguousTrigger.edges.every((e) => e.state === 'REVIEW'),
    JSON.stringify(ambiguousTrigger.edges.map((e) => e.state)),
  );
  const scopedTrigger = proposeEdges(
    [{ clauseId: 8, citation: cite({ number: '1', raw: 'unable to comply with para 1' }) }],
    CLAUSES,
    [...RULES, { id: 71, clauseId: 7, attributeIds: [], state: 'ACTIVE' }, { id: 81, clauseId: 8, attributeIds: [], state: 'ACTIVE' }],
  );
  check(
    'a SCOPED depends_on is REVIEW too — the best guess available is still a guess',
    scopedTrigger.edges.length === 1 && scopedTrigger.edges[0].state === 'REVIEW' && scopedTrigger.edges[0].confidence === 0.7,
    JSON.stringify(scopedTrigger.edges.map((e) => [e.state, e.confidence])),
  );
  check(
    'an exactly resolved depends_on IS active',
    trigger.edges.every((e) => e.state === 'ACTIVE' && e.confidence === 0.9),
  );
  check(
    'confidence records how the target was found',
    trigger.edges[0].confidence > ambiguousTrigger.edges[0].confidence,
    `${trigger.edges[0].confidence} vs ${ambiguousTrigger.edges[0].confidence}`,
  );

  section('16a · the four consumed citation kinds produce nothing here');
  for (const kind of ['definitional', 'exemption', 'reference'] as const) {
    const res = proposeEdges([{ clauseId: 5, citation: cite({ kind }) }], CLAUSES, RULES);
    check(
      `${kind} produces no edge (consumed at an earlier step)`,
      res.edges.length === 0 && res.parked.length === 0,
    );
  }

  section('16a · citations with nothing to hang an edge on are parked, not dropped');
  const noSource = proposeEdges([{ clauseId: 3, citation: cite() }], CLAUSES, RULES);
  check(
    'a citing clause that produced no rule parks',
    noSource.edges.length === 0 && noSource.parked[0]?.reason === 'no_source_rule',
  );
  const noTargetRules = proposeEdges(
    [{ clauseId: 5, citation: cite({ number: '2', raw: 'unable to comply with para 2' }) }],
    CLAUSES,
    RULES,
  );
  check(
    'a resolved clause that produced no rule parks',
    noTargetRules.edges.length === 0 && noTargetRules.parked[0]?.reason === 'target_has_no_rules',
  );
  const absentParks = proposeEdges(
    [{ clauseId: 5, citation: cite({ number: '77.7', raw: 'unable to comply with para 77.7' }) }],
    CLAUSES,
    RULES,
  );
  check('a citation to an un-ingested paragraph parks for the sweep', absentParks.parked[0]?.reason === 'absent');

  // ── cycles ────────────────────────────────────────────────────────────────
  section('cycles · refused at INSERT, never at evaluation');

  const chain = [
    { fromId: 1, toId: 2, type: 'depends_on' },
    { fromId: 2, toId: 3, type: 'depends_on' },
  ];
  check('A→B→C is not a cycle', !wouldCycle(chain, 3, 4));
  check('C→A closes A→B→C→A', wouldCycle(chain, 3, 1));
  check('a self-edge is a cycle', wouldCycle([], 5, 5));
  check(
    'a non-depends_on edge is not walked — split_of points at a sibling',
    !wouldCycle([{ fromId: 1, toId: 2, type: 'split_of' }, { fromId: 2, toId: 3, type: 'split_of' }], 3, 1),
  );

  const proposed: ProposedEdge[] = [
    { fromId: 1, toId: 2, type: 'depends_on', state: 'ACTIVE', confidence: 1, sourceCitation: {} },
    { fromId: 2, toId: 3, type: 'depends_on', state: 'ACTIVE', confidence: 1, sourceCitation: {} },
    { fromId: 3, toId: 1, type: 'depends_on', state: 'ACTIVE', confidence: 1, sourceCitation: {} },
  ];
  const admitted = admitEdges([], proposed);
  check(
    'A→B→C→A: the first two are admitted, the third refused',
    admitted.admitted.length === 2 && admitted.refused.length === 1,
    JSON.stringify(admitted.refused.map((r) => `${r.edge.fromId}->${r.edge.toId}`)),
  );
  check('the refusal names the reason', admitted.refused[0]?.reason === 'cycle');
  check(
    'admission is one at a time — a batch cannot smuggle a cycle in',
    !wouldCycle(admitted.admitted, 3, 1) === false,
    'after admitting A→B→C, C→A is still correctly identified as a cycle',
  );

  const twice = admitEdges(
    [{ fromId: 1, toId: 2, type: 'depends_on' }],
    [{ fromId: 1, toId: 2, type: 'depends_on', state: 'ACTIVE', confidence: 1, sourceCitation: {} }],
  );
  check('re-ingesting the same document does not duplicate an edge', twice.admitted.length === 0 && twice.refused.length === 0);

  // ── shared_evidence ───────────────────────────────────────────────────────
  section('shared_evidence · computed from overlap, not read from the text');

  const groups = sharedEvidenceGroups(RULES);
  check(
    'two rules needing the same evidence group together',
    groups.length === 1 && groups[0].ruleIds.join(',') === '41,42',
    JSON.stringify(groups),
  );
  check('a rule with unique attributes forms no group', !groups.some((g) => g.ruleIds.includes(43)));
  check(
    'grouping is by the SET of attributes, so the group is one upload',
    groups[0].attributeIds.join(',') === '100,200',
  );
  check(
    'a rule with no attributes never shares evidence with everything',
    sharedEvidenceGroups([
      { id: 1, clauseId: 1, attributeIds: [], state: 'ACTIVE' },
      { id: 2, clauseId: 2, attributeIds: [], state: 'ACTIVE' },
    ]).length === 0,
    'minShared=1 is what stops the empty set matching every rule',
  );

  // ── split_of ──────────────────────────────────────────────────────────────
  section('split_of · structural');

  const splits = splitEdges(RULES);
  check(
    'a clause yielding three rules produces two split_of edges to the first',
    splits.length === 2 && splits.every((e) => e.toId === 41 && e.type === 'split_of'),
    JSON.stringify(splits.map((e) => `${e.fromId}->${e.toId}`)),
  );
  check('a clause yielding one rule produces none', !splits.some((e) => e.fromId === 51));
  check('split_of is certain — it is structural, not inferred', splits.every((e) => e.confidence === 1));

  // ── 16b the retry sweep ───────────────────────────────────────────────────
  section('16b · the retry sweep, keyed on container + number');

  const parked = [
    {
      id: 1,
      fromClauseId: 5,
      fromObligationId: 51,
      rawText: 'unable to comply with para 3.1',
      targetDoc: null,
      targetContainer: null,
      targetClauseNo: '3.1',
      edgeType: 'depends_on',
      attempts: 0,
    },
    {
      id: 2,
      fromClauseId: 5,
      fromObligationId: 51,
      rawText: 'para 1 of Annexure A',
      targetDoc: null,
      targetContainer: 'Annexure A',
      targetClauseNo: '1',
      edgeType: 'depends_on',
      attempts: 0,
    },
    {
      id: 3,
      fromClauseId: 5,
      fromObligationId: 51,
      rawText: 'para 99',
      targetDoc: null,
      targetContainer: null,
      targetClauseNo: '99',
      edgeType: 'depends_on',
      attempts: 4,
    },
  ];
  const arrived = {
    docId: 'DOC-2019',
    clauses: [
      { id: 501, clauseNo: '3.1', parentId: null, citable: true, container: null },
      { id: 502, clauseNo: '1', parentId: null, citable: true, container: 'Annexure A' },
      { id: 503, clauseNo: '1', parentId: null, citable: true, container: 'Annexure B' },
    ] as ClauseNode[],
  };
  const swept = sweepCandidates(parked, arrived);
  check(
    'a citation waiting for a document resolves when that document lands',
    swept.resolve.some((r) => r.parked.id === 1 && r.clauseId === 501),
    JSON.stringify(swept.resolve.map((r) => [r.parked.id, r.clauseId])),
  );
  check(
    'the container is part of the key — Annexure A para 1, not Annexure B',
    swept.resolve.some((r) => r.parked.id === 2 && r.clauseId === 502),
    'clause "1" exists 152x in CSCRF; a queue keyed on the number alone wakes for all of them',
  );
  check(
    'a citation whose target never arrives is eventually abandoned',
    swept.abandon.some((p) => p.id === 3),
    'otherwise the queue is swept on every future ingest, forever',
  );
  const otherDoc = sweepCandidates(
    [{ ...parked[0], targetDoc: 'DOC-OTHER' }],
    arrived,
  );
  check(
    'a citation naming a different document is not woken by this one',
    otherDoc.resolve.length === 0,
  );

  // ── the D8 acceptance line ────────────────────────────────────────────────
  section('acceptance');
  check(
    '"unable to comply with 9.5.3.1" → depends_on with sourceCitation populated',
    trigger.edges.length > 0 &&
      trigger.edges[0].type === 'depends_on' &&
      Boolean(trigger.edges[0].sourceCitation.raw),
  );
  check(
    'A→B→C→A is refused at insert, never at evaluation',
    admitted.refused.length === 1 && admitted.refused[0].reason === 'cycle',
  );
  check(
    'citing an un-ingested document parks, and the sweep resolves it on arrival',
    absentParks.parked.length === 1 && swept.resolve.length === 2,
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
