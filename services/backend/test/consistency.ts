/**
 * D9 — Step 17 consistency checks (run: `npm run test:consistency`).
 *
 * The engine is pure, so the whole finding surface is checkable without a
 * database — including the scale claim, which is the one that decides whether
 * this can run on a real corpus at all.
 */

import 'reflect-metadata';
import {
  CheckedAudience,
  CheckedRule,
  Constraint,
  conflicts,
  runChecks,
} from '../src/ingestion/consistency.engine';

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
const section = (t: string) => console.log(`\n${t}`);

const AUD_QSB = 7;
const AUD_BROKER = 8;
const AUD_ADVISER = 9;

const audiences = new Map<number, CheckedAudience>([
  [AUD_QSB, { id: AUD_QSB, label: 'QSBs', conditions: ["category == 'stock_broker'", 'is_qsb == true'] }],
  [AUD_BROKER, { id: AUD_BROKER, label: 'Stock Brokers', conditions: ["category == 'stock_broker'"] }],
  [AUD_ADVISER, { id: AUD_ADVISER, label: 'Investment Advisers', conditions: ["category == 'investment_adviser'"] }],
]);

let nextId = 1;
function rule(over: Partial<CheckedRule> & { constraints?: Constraint[] } = {}): CheckedRule {
  return {
    id: nextId++,
    title: `rule ${nextId}`,
    state: 'ACTIVE',
    identityHash: `ID_${nextId}`,
    audienceId: AUD_QSB,
    attributeIds: [4471],
    constraints: [],
    sourceSpans: [{ doc_id: 'CIR-A' }],
    docIds: ['CIR-A'],
    ...over,
  };
}
const c = (op: Constraint['op'], value: number, shape = '#4471'): Constraint => ({
  attribute_ids: [4471],
  shape,
  op,
  value,
});

async function main() {
  section('interval arithmetic');
  check('<=180 and >=365 conflict', conflicts(c('<=', 180), c('>=', 365)));
  check('<=180 and <=90 do NOT conflict', !conflicts(c('<=', 180), c('<=', 90)));
  check('>=180 and <=180 do not conflict (180 satisfies both)', !conflicts(c('>=', 180), c('<=', 180)));
  check('>180 and <=180 DO conflict (no value left)', conflicts(c('>', 180), c('<=', 180)));
  check('==90 and ==180 conflict', conflicts(c('==', 90), c('==', 180)));
  check(
    'different shapes are never compared',
    !conflicts(c('<=', 180, '#4471'), c('>=', 365, 'call:days_between(#4471,#1)')),
  );
  check('!= alone cannot empty a range', !conflicts(c('!=', 90), c('<=', 180)));

  section('CONTRADICTION — the headline case');
  {
    // QSB ⊂ stock broker, so the audiences provably overlap: no QSB can comply.
    const a = rule({ title: 'QSB cyber audit', audienceId: AUD_QSB, constraints: [c('<=', 180)] });
    const b = rule({ title: 'broker cyber audit', audienceId: AUD_BROKER, constraints: [c('>=', 365)] });
    const report = runChecks([a, b], audiences);
    check('exactly one contradiction', report.counts.CONTRADICTION === 1, String(report.counts.CONTRADICTION));
    const finding = report.findings.find((f) => f.family === 'CONTRADICTION');
    check('both rules are named', JSON.stringify(finding?.rules) === JSON.stringify([a.id, b.id]));
    check('severity is high', finding?.severity === 'high');
    check(
      'and it points at the likely step',
      /Step 10|Step 12/.test(finding?.likelyCause ?? ''),
      finding?.likelyCause,
    );
  }

  section('...but only where the audiences PROVABLY overlap');
  {
    const a = rule({ audienceId: AUD_QSB, constraints: [c('<=', 180)] });
    const b = rule({ audienceId: AUD_ADVISER, constraints: [c('>=', 365)] });
    const report = runChecks([a, b], audiences);
    check(
      'brokers and advisers are disjoint — no finding',
      report.counts.CONTRADICTION === 0,
      String(report.counts.CONTRADICTION),
    );
    // Two unrelated tests may well overlap in reality, but that cannot be proven
    // from the tests alone, and an unproven contradiction is a false positive
    // aimed at a human.
  }

  section('...and only between LIVE rules');
  {
    const a = rule({ audienceId: AUD_QSB, constraints: [c('<=', 180)] });
    const b = rule({ audienceId: AUD_BROKER, constraints: [c('>=', 365)], state: 'SUPERSEDED' });
    check('a superseded rule contradicts nothing', runChecks([a, b], audiences).counts.CONTRADICTION === 0);
  }

  section('REDUNDANCY — the duplicate Step 15 cannot catch');
  {
    const a = rule({ identityHash: 'ID_SAME', constraints: [c('<=', 180)] });
    const b = rule({ identityHash: 'ID_SAME', constraints: [c('<=', 180)] });
    const report = runChecks([a, b], audiences);
    const dupes = report.findings.filter((f) => f.family === 'REDUNDANCY' && f.rules.length === 2);
    check('two ACTIVE rules with one identity are reported', dupes.length >= 1, String(dupes.length));
    check('it names Step 15 as the cause', /Step 15/.test(dupes[0]?.likelyCause ?? ''), dupes[0]?.likelyCause);
  }

  section('REDUNDANCY — subsumption');
  {
    const broad = rule({ audienceId: AUD_BROKER, identityHash: 'ID_B', constraints: [c('<=', 180)] });
    const narrow = rule({ audienceId: AUD_QSB, identityHash: 'ID_N', constraints: [c('<=', 180)] });
    const report = runChecks([broad, narrow], audiences);
    const sub = report.findings.filter((f) => f.family === 'REDUNDANCY' && f.severity === 'low');
    check('the narrower rule is flagged as adding nothing', sub.length === 1, String(sub.length));
    check('and it is the NARROW one named first', sub[0]?.rules[0] === narrow.id);
  }

  section('DEAD RULE');
  {
    const impossible = rule({ constraints: [c('<=', 5), c('>=', 90)] });
    const report = runChecks([impossible], audiences);
    check('a rule demanding both is dead', report.counts.DEAD_RULE >= 1);
  }
  {
    const contradictoryAudience = new Map(audiences);
    contradictoryAudience.set(99, {
      id: 99,
      label: 'impossible',
      conditions: ['is_qsb == true', 'is_qsb == false'],
    });
    const r = rule({ audienceId: 99 });
    const report = runChecks([r], contradictoryAudience);
    const dead = report.findings.filter((f) => f.family === 'DEAD_RULE');
    check('is_qsb true AND false selects nobody', dead.length === 1, String(dead.length));
    check('it names Step 10', /Step 10/.test(dead[0]?.likelyCause ?? ''));
  }
  {
    const orphan = rule({ audienceId: null });
    const dead = runChecks([orphan], audiences).findings.filter((f) => f.family === 'DEAD_RULE');
    check('a rule with no audience is reported', dead.length === 1);
  }

  section('INTEGRITY');
  {
    const noSpan = rule({ sourceSpans: [] });
    const report = runChecks([noSpan], audiences);
    check('a rule with no source span breaks the audit pack', report.counts.INTEGRITY === 1);
  }
  {
    const a = rule();
    const b = rule({ state: 'SUPERSEDED' });
    const edges = [{ id: 1, fromId: a.id, toId: b.id, type: 'depends_on', state: 'ACTIVE' }];
    const report = runChecks([a, b], audiences, edges);
    check(
      'an ACTIVE edge into a SUPERSEDED rule is reported',
      report.findings.some((f) => f.family === 'INTEGRITY' && /SUPERSEDED/.test(f.message)),
    );
  }
  {
    const a = rule();
    const b = rule();
    const edges = [
      { id: 1, fromId: a.id, toId: b.id, type: 'depends_on', state: 'ACTIVE' },
      { id: 2, fromId: b.id, toId: a.id, type: 'depends_on', state: 'ACTIVE' },
    ];
    const report = runChecks([a, b], audiences, edges);
    check(
      'a depends_on cycle is reported',
      report.findings.some((f) => /cycle/.test(f.message)),
    );
  }

  {
    // Step 10e — the approval gate has teeth only if something checks it. The
    // pipeline deliberately does NOT block on approval (parsing and drafting
    // must not wait), so this is where an unapproved audience surfaces.
    const proposed = new Map<number, CheckedAudience>([
      ...audiences,
      [
        90,
        {
          id: 90,
          label: 'Brokers using cloud',
          conditions: ["category == 'stock_broker'", 'uses_cloud_services == true'],
          state: 'PROPOSED',
        },
      ],
    ]);
    const under = [rule({ audienceId: 90 }), rule({ audienceId: 90 }), rule({ audienceId: 90 })];
    const report = runChecks(under, proposed);
    const finding = report.findings.find((f) => /nobody has approved/.test(f.message));
    check('rules filed under an unapproved audience are reported', Boolean(finding));
    check(
      'and they are reported as ONE finding, not one per rule',
      finding?.rules.length === 3 && report.counts.INTEGRITY === 1,
      `${report.counts.INTEGRITY} integrity findings`,
    );
    check(
      'the finding names the audience and its test, so it can be approved',
      /Brokers using cloud/.test(finding?.message ?? '') &&
        /uses_cloud_services/.test(finding?.message ?? ''),
      finding?.message,
    );
    const approved = new Map<number, CheckedAudience>([
      ...audiences,
      [90, { id: 90, label: 'Brokers using cloud', conditions: ["category == 'stock_broker'"], state: 'APPROVED' }],
    ]);
    check(
      'an APPROVED audience produces nothing',
      !runChecks(under, approved).findings.some((f) => /nobody has approved/.test(f.message)),
    );
    check(
      'an audience with no state at all is not reported — it predates the gate',
      !runChecks(under, new Map([...audiences, [90, { id: 90, label: 'x', conditions: [] }]])).findings.some(
        (f) => /nobody has approved/.test(f.message),
      ),
      'backfilling old rows as violations would bury the real queue',
    );
  }

  section('findings cluster by root cause');
  {
    // One mis-resolved audience produces many contradictions. That is ONE
    // problem to fix, not many, and the report has to say so.
    const rules: CheckedRule[] = [];
    for (let i = 0; i < 20; i++) {
      rules.push(rule({ audienceId: AUD_QSB, constraints: [c('<=', 180, `#${i}`)] }));
      rules.push(rule({ audienceId: AUD_BROKER, constraints: [c('>=', 365, `#${i}`)] }));
      rules[rules.length - 1].attributeIds = [i];
      rules[rules.length - 2].attributeIds = [i];
      rules[rules.length - 1].constraints[0].attribute_ids = [i];
      rules[rules.length - 2].constraints[0].attribute_ids = [i];
    }
    const report = runChecks(rules, audiences);
    check('20 contradictions found', report.counts.CONTRADICTION === 20, String(report.counts.CONTRADICTION));
    check('but clustered into one cause', report.byLikelyCause.length === 1, JSON.stringify(report.byLikelyCause.map((c) => c.cause)));
  }

  section('SCALE — bucketing keeps it near-linear');
  {
    const N = 50000;
    const rules: CheckedRule[] = [];
    for (let i = 0; i < N; i++) {
      const attr = i % 5000; // ~10 rules per attribute, as in a real registry
      rules.push({
        id: i + 1,
        title: `r${i}`,
        state: 'ACTIVE',
        identityHash: `ID_${i}`,
        audienceId: i % 2 === 0 ? AUD_QSB : AUD_BROKER,
        attributeIds: [attr],
        constraints: [{ attribute_ids: [attr], shape: `#${attr}`, op: '<=', value: 100 + (i % 7) }],
        sourceSpans: [{ doc_id: 'CIR' }],
        docIds: ['CIR'],
      });
    }
    // Three planted contradictions. A scale test that finds NOTHING proves only
    // that it did not crash — it has to still detect at size, or the bucketing
    // could be silently skipping work.
    const planted = [4242, 9001, 31337];
    for (const [n, id] of planted.entries()) {
      rules.push({
        id: 900000 + n,
        title: `planted ${n}`,
        state: 'ACTIVE',
        identityHash: `ID_PLANT_${n}`,
        audienceId: AUD_BROKER,
        attributeIds: [id % 5000],
        constraints: [{ attribute_ids: [id % 5000], shape: `#${id % 5000}`, op: '>=', value: 9999 }],
        sourceSpans: [{ doc_id: 'CIR' }],
        docIds: ['CIR'],
      });
    }

    const started = Date.now();
    const report = runChecks(rules, audiences);
    const ms = Date.now() - started;
    console.log(
      `     ${rules.length} rules over 5,000 attributes → ${ms}ms, ` +
        `${report.counts.CONTRADICTION} contradictions`,
    );
    check('completes in under 30s', ms < 30000, `${ms}ms`);
    check('checked every rule', report.checked.checked === rules.length);
    check(
      'and STILL finds the planted contradictions at scale',
      report.counts.CONTRADICTION >= planted.length,
      String(report.counts.CONTRADICTION),
    );
    // Without bucketing this is 1.25 billion pairs; with it, ~10 per bucket.
  }

  console.log('\n' + '─'.repeat(64));
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
