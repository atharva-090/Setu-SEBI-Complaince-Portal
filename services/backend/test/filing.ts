/**
 * D7 — Step 15 filing (run: `npm run test:filing`).
 *
 * Drives the REAL filing engine with controlled assertions. No Docker, no
 * database: the engine is pure by design, because the claim being tested is a
 * claim about ORDER — that replaying the same events in any arrival order
 * yields the same graph — and that is only checkable if the graph is a function
 * of the log.
 */

import 'reflect-metadata';
import {
  Assertion,
  Decision,
  Graph,
  apply as applyToGraph,
  classify,
  emptyGraph,
  explain,
  project,
} from '../src/ingestion/filing.engine';

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

let seq = 0;
function assertion(over: Partial<Assertion> & { docId: string; key: string }): Assertion {
  return {
    seq: seq++,
    identityHash: 'ID_AUDIT_QSB',
    fullHash: 'FULL_180',
    audienceId: 7,
    attributeIds: [4471],
    effectiveFrom: '2024-01-01',
    ...over,
  };
}

const activeRules = (g: Graph) => [...g.rules.values()].filter((r) => r.state === 'ACTIVE');

async function main() {
  section('the same circular twice — a restatement adds nothing');
  {
    const log = [
      assertion({ docId: 'CIR-A', key: 'r1' }),
      assertion({ docId: 'CIR-A', key: 'r1' }), // re-ingested, byte-identical
    ];
    const g = project(log);
    check('one obligation, not two', activeRules(g).length === 1, String(activeRules(g).length));
    check('nothing staged', g.staged.length === 0);
    check('nothing in review', g.review.length === 0);
    const decisions = explain(log).map((d) => d.decision.verdict);
    check('verdicts are new then restatement', JSON.stringify(decisions) === '["new","restatement"]', JSON.stringify(decisions));
  }

  section('a different circular restating the same duty');
  {
    const log = [
      assertion({ docId: 'CIR-A', key: 'r1' }),
      assertion({ docId: 'CIR-B', key: 'r9' }), // same hashes, different document
    ];
    const g = project(log);
    check('still one obligation', activeRules(g).length === 1);
    check(
      'both documents recorded as saying it',
      activeRules(g)[0].sourceDocs.join(',') === 'CIR-A,CIR-B',
      activeRules(g)[0].sourceDocs.join(','),
    );
  }

  section('180 → 120 — an amendment stages, never auto-applies');
  {
    const log = [
      assertion({ docId: 'CIR-A', key: 'r1', effectiveFrom: '2023-01-01' }),
      assertion({ docId: 'CIR-2026', key: 'r1', fullHash: 'FULL_120', effectiveFrom: '2026-04-01' }),
    ];
    const g = project(log);
    check('no second obligation was created', activeRules(g).length === 1, String(activeRules(g).length));
    check('the live rule is UNCHANGED', activeRules(g)[0].fullHash === 'FULL_180', activeRules(g)[0].fullHash);
    check('the live rule is still ACTIVE', activeRules(g)[0].state === 'ACTIVE');
    check('a version is STAGED', g.staged.length === 1);
    check('staged as version 2', g.staged[0]?.version === 2);
    check('staged with the new value', g.staged[0]?.toFullHash === 'FULL_120');
    check(
      'the verdict is amendment, decided by the fingerprint lane',
      explain(log)[1].decision.verdict === 'amendment' && explain(log)[1].decision.lane === 'fingerprint',
    );
  }

  section('THE KEY ONE — out-of-order ingestion replays to the same graph');
  {
    const original = assertion({ docId: 'CIR-2023', key: 'r1', effectiveFrom: '2023-01-01' });
    const amendment = assertion({
      docId: 'CIR-2026',
      key: 'r1',
      fullHash: 'FULL_90',
      effectiveFrom: '2026-04-01',
    });

    const inOrder = project([original, amendment]);
    // The amendment PDF happened to be downloaded first.
    const reversed = project([{ ...amendment, seq: 0 }, { ...original, seq: 1 }]);

    check(
      'same number of live obligations',
      activeRules(inOrder).length === activeRules(reversed).length,
      `${activeRules(inOrder).length} vs ${activeRules(reversed).length}`,
    );
    check(
      'the live rule is the SAME rule',
      activeRules(inOrder)[0].fullHash === activeRules(reversed)[0].fullHash,
      `${activeRules(inOrder)[0].fullHash} vs ${activeRules(reversed)[0].fullHash}`,
    );
    check(
      'the same amendment is staged either way',
      inOrder.staged.length === reversed.staged.length &&
        inOrder.staged[0]?.toFullHash === reversed.staged[0]?.toFullHash,
      `${inOrder.staged[0]?.toFullHash} vs ${reversed.staged[0]?.toFullHash}`,
    );
    check(
      'and the 2023 original is what stays live — not the 2026 value',
      activeRules(reversed)[0].fullHash === 'FULL_180',
      activeRules(reversed)[0].fullHash,
    );
    // Without replay this is exactly the silent corruption Step 15a describes:
    // the amendment files as NEW, the original then files as an AMENDMENT of it,
    // and the graph ends up asserting the OLD value with no error raised.
  }

  section('a retroactive circular inserts into the past');
  {
    const log = [
      assertion({ docId: 'CIR-JAN', key: 'r1', effectiveFrom: '2026-01-01' }),
      // Arrives in March, effective from February — before the March filing.
      assertion({ docId: 'CIR-FEB', key: 'r1', fullHash: 'FULL_150', effectiveFrom: '2026-02-01' }),
    ];
    const order = explain(log).map((e) => e.assertion.docId);
    check('replay orders by effective date, not arrival', order.join(',') === 'CIR-JAN,CIR-FEB', order.join(','));
  }

  section('"para 9.5 stands withdrawn" — repeal, the citation lane');
  {
    const log = [
      assertion({ docId: 'CIR-A', key: 'r1', effectiveFrom: '2023-01-01' }),
      assertion({
        docId: 'CIR-REPEAL',
        key: 'r1',
        identityHash: 'ID_SOMETHING_ELSE',
        fullHash: 'FULL_OTHER',
        effectiveFrom: '2026-01-01',
        citations: [
          { kind: 'repeals', targetIdentityHash: 'ID_AUDIT_QSB', raw: 'para 9.5 of CIR-A stands withdrawn' },
        ],
      }),
    ];
    const g = project(log);
    const repealed = [...g.rules.values()].find((r) => r.identityHash === 'ID_AUDIT_QSB');
    check('the cited rule is SUPERSEDED', repealed?.state === 'SUPERSEDED', repealed?.state);
    check('no live rule is left with that identity', activeRules(g).every((r) => r.identityHash !== 'ID_AUDIT_QSB'));
    check(
      'the verdict is repeal, decided by the citation lane',
      explain(log)[1].decision.verdict === 'repeal' && explain(log)[1].decision.lane === 'citation',
    );
    // A repeal produces NO incoming rule to fingerprint — there is nothing to
    // hash. Only the citation lane can reach it, which is why lane 2 exists.
  }

  section('lane 2 outranks lane 1 when they disagree');
  {
    const g = emptyGraph();
    const original = assertion({ docId: 'CIR-A', key: 'r1' });
    apply(g, original);
    const conflicting = assertion({
      docId: 'CIR-B',
      key: 'r1',
      fullHash: 'FULL_120', // lane 1 would call this an amendment
      citations: [
        { kind: 'repeals', targetIdentityHash: 'ID_AUDIT_QSB', raw: 'stands withdrawn' },
      ],
    });
    const decision = classify(conflicting, g);
    check(
      'the citation wins — repeal, not amendment',
      decision.verdict === 'repeal' && decision.lane === 'citation',
      `${decision.verdict}/${decision.lane}`,
    );
    // The hash is an inference; the citation is a fact.
  }

  section('ambiguity commits nothing');
  {
    // Two live rules share an identity — only reachable if something upstream
    // went wrong, which is exactly when nothing should be committed.
    const g = emptyGraph();
    apply(g, assertion({ docId: 'CIR-A', key: 'r1' }));
    apply(g, assertion({ docId: 'CIR-B', key: 'r2' , fullHash: 'FULL_180' }));
    // force a duplicate identity into the projection
    const dupe = { ...activeRules(g)[0], id: 'forced', fullHash: 'FULL_999' };
    g.rules.set('forced', dupe);

    const incoming = assertion({ docId: 'CIR-C', key: 'r3', fullHash: 'FULL_150' });
    const decision = classify(incoming, g);
    check('verdict is ambiguous', decision.verdict === 'ambiguous', decision.verdict);
    const before = activeRules(g).length;
    applyDecision(g, incoming, decision);
    check('no obligation added', activeRules(g).length === before);
    check('nothing staged', g.staged.length === 0);
    check('it lands in the review queue', g.review.length === 1);
  }

  section('lane 3 produces candidates, never decisions');
  {
    const g = emptyGraph();
    apply(g, assertion({ docId: 'CIR-A', key: 'r1' }));
    const related = assertion({
      docId: 'CIR-B',
      key: 'r2',
      identityHash: 'ID_DIFFERENT_SHAPE', // an added condition changed identity
      fullHash: 'FULL_NEW',
      audienceId: 7,
      attributeIds: [4471, 5120],
    });
    const decision = classify(related, g);
    check('still files as NEW', decision.verdict === 'new', decision.verdict);
    check('but flags the overlap as a candidate', (decision.candidates ?? []).length === 1);
    check('and says the fuzzy lane found it', decision.lane === 'fuzzy');

    const unrelated = assertion({
      docId: 'CIR-C',
      key: 'r3',
      identityHash: 'ID_UNRELATED',
      audienceId: 99,
      attributeIds: [888],
    });
    check('a different audience produces no candidates', classify(unrelated, g).candidates === undefined);
  }

  section('determinism');
  {
    const log = [
      assertion({ docId: 'CIR-A', key: 'r1', effectiveFrom: '2023-01-01' }),
      assertion({ docId: 'CIR-B', key: 'r1', fullHash: 'FULL_120', effectiveFrom: '2026-01-01' }),
      assertion({ docId: 'CIR-C', key: 'r1', effectiveFrom: '2024-01-01' }),
    ];
    const shapes = new Set(
      [0, 1, 2, 3, 4].map(() =>
        JSON.stringify(
          project([...log].sort(() => Math.random() - 0.5)).staged.map((s) => s.toFullHash),
        ),
      ),
    );
    check('5 shuffled replays, one graph', shapes.size === 1, [...shapes].join(' | '));
  }

  console.log('\n' + '─'.repeat(64));
  if (failures.length) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed:`);
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log(`PASSED — all ${passed} assertions green.`);
}

/** Helpers mirroring what project() does, for the step-by-step sections. */
function apply(graph: Graph, incoming: Assertion) {
  applyToGraph(incoming, classify(incoming, graph), graph);
}
function applyDecision(graph: Graph, incoming: Assertion, decision: Decision) {
  applyToGraph(incoming, decision, graph);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
