/**
 * D3 — Step 12 assembly (run: `npm run test:assembly`).
 *
 * Drives the REAL assembly engine. No Docker, no database: every claim is about
 * a DECISION — what a modifier points at, which of the four effects applies,
 * whether a condition may touch the audience at all, and above all the ORDER
 * things happen in.
 *
 * The last of those is the one that matters most. A rule fingerprinted BEFORE
 * its modifiers are applied, then narrowed afterwards, is a phantom amendment of
 * a duty nobody amended. So the ordering is asserted directly: the hash of the
 * assembled rule differs from the hash of the unassembled one.
 */

import 'reflect-metadata';
import { createHash } from 'crypto';
import {
  Applicability,
  AssemblyRule,
  DraftedModifier,
  assemble,
  buildIndex,
  findTerm,
  flatten,
  isFirmCondition,
  render,
  resolveModifier,
} from '../src/ingestion/assembly.engine';
import { ClauseNode } from '../src/ingestion/links.engine';

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
//   1  9.5      Audit requirements
//   2    9.5.1    a cyber audit every 180 days       ← the rule things point at
//   3    9.5.2    "9.5.1 applies only to >5,000 clients"
//   4    9.5.4    "9.5.1 shall also apply to clearing members"
//   5  12.3     daily transaction reports
//   6  12.7     "nothing in 12.3 applies to <500 clients"
//   7  12.9     "the exemption in 12.7 shall not apply to those holding client funds"
//   8  18.9     "for QSBs, the period in 9.5.1 shall be 90 days"
//
const CLAUSES: ClauseNode[] = [
  { id: 1, clauseNo: '9.5', parentId: null, citable: true, container: null },
  { id: 2, clauseNo: '9.5.1', parentId: 1, citable: true, container: null },
  { id: 3, clauseNo: '9.5.2', parentId: 1, citable: true, container: null },
  { id: 4, clauseNo: '9.5.4', parentId: 1, citable: true, container: null },
  { id: 5, clauseNo: '12.3', parentId: null, citable: true, container: null },
  { id: 6, clauseNo: '12.7', parentId: null, citable: true, container: null },
  { id: 7, clauseNo: '12.9', parentId: null, citable: true, container: null },
  { id: 8, clauseNo: '18.9', parentId: null, citable: true, container: null },
];

const VOCAB = new Set([
  'category', 'is_qsb', 'is_clearing_member', 'holds_client_funds', 'active_clients',
]);

const BROKERS = ["category == 'stock_broker'"];

function rule(over: Partial<AssemblyRule> = {}): AssemblyRule {
  return {
    key: 'r1',
    clauseId: 2,
    clauseNo: '9.5.1',
    title: 'cyber audit every 180 days',
    audienceConditions: [...BROKERS],
    audienceId: 1,
    ...over,
  };
}

function mod(over: Partial<DraftedModifier> = {}): DraftedModifier {
  return {
    fromClauseNo: '9.5.2',
    fromClauseId: 3,
    effect: 'restrict_scope',
    targets: '9.5.1',
    condition: 'active_clients > 5000',
    raw: 'The provisions of 9.5.1 shall apply only to brokers with more than 5,000 clients.',
    confidence: 0.9,
    ...over,
  };
}

/** Stands in for Step 14's fingerprint: audience + shape. */
function identity(conditions: string[] | null, shape: string): string {
  return createHash('sha256')
    .update(`${(conditions ?? ['UNEXPRESSIBLE']).join('|')}::${shape}`)
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  // ── 12b · resolve what each modifier points at ────────────────────────────
  section('12b · a modifier targets a STRING; resolving finds the clause');

  const resolved = resolveModifier(mod(), CLAUSES);
  check(
    '"9.5.1" resolves to the clause that produced the rule',
    resolved.clauseIds.length === 1 && resolved.clauseIds[0] === 2,
    JSON.stringify(resolved),
  );
  const orphan = resolveModifier(mod({ targets: '77.7' }), CLAUSES);
  check(
    'a target this document does not contain is orphaned, not guessed',
    orphan.clauseIds.length === 0,
    'usually means the clause it points at was lost upstream',
  );

  // ── 12c · the index ───────────────────────────────────────────────────────
  section('12c · the index is keyed by CLAUSE ID, never by the text "9.5.1"');

  const built = buildIndex([mod(), mod({ fromClauseNo: '9.5.4', fromClauseId: 4, effect: 'extend_scope', condition: 'is_clearing_member == true' })], CLAUSES);
  check(
    'two modifiers on one clause group together',
    built.index.get(2)?.length === 2,
    JSON.stringify([...built.index.keys()]),
  );
  check('nothing is orphaned when both resolve', built.orphaned.length === 0);
  const withOrphan = buildIndex([mod({ targets: '77.7' })], CLAUSES);
  check('an unresolvable target lands in the orphan list', withOrphan.orphaned.length === 1);

  // ⚠️ A MODIFIER NEVER FANS OUT. Step 16 spreads a depends_on edge across every
  // rule of an ambiguously resolved clause because over-linking is recoverable.
  // A modifier is the other kind: restricting five rules when SEBI meant one
  // silently removes four duties, and nothing downstream can detect it.
  //
  // Found by a live run — "3.3.2.3" matched five clauses in the mutual funds
  // circular and one modifier was applied thirty-five times.
  const AMBIG: ClauseNode[] = [
    ...CLAUSES,
    { id: 20, clauseNo: '3.3.2.3', parentId: null, citable: true, container: null },
    { id: 21, clauseNo: '3.3.2.3', parentId: null, citable: true, container: null },
  ];
  const spread = buildIndex([mod({ targets: '3.3.2.3', fromClauseId: null })], AMBIG);
  check(
    'a target naming several clauses is REFUSED, not applied to all of them',
    spread.ambiguous.length === 1 && spread.index.size === 0,
    JSON.stringify({ ambiguous: spread.ambiguous.length, indexed: spread.index.size }),
  );
  {
    const r = assemble(
      [rule({ clauseId: 20, clauseNo: '3.3.2.3' }), rule({ key: 'r2', clauseId: 21, clauseNo: '3.3.2.3' })],
      [mod({ targets: '3.3.2.3', fromClauseId: null })],
      AMBIG,
      VOCAB,
    );
    check(
      'and neither rule is touched',
      r.stats.applied === 0 && r.rules.every((x) => x.conditions?.join('|') === BROKERS.join('|')),
      JSON.stringify(r.stats),
    );
    check(
      'the refusal is flagged with how many clauses it matched',
      r.flags.some((f) => f.kind === 'ambiguous_target' && /2 different clauses/.test(f.message)),
      JSON.stringify(r.flags.map((f) => f.message)),
    );
  }

  // ── 12d · the four effects ────────────────────────────────────────────────
  section('12d · the four effects');

  {
    const r = assemble([rule()], [mod()], CLAUSES, VOCAB);
    check(
      'restrict_scope ANDs the condition onto the audience',
      r.rules[0].conditions?.includes('active_clients > 5000') === true &&
        r.rules[0].conditions?.includes("category == 'stock_broker'") === true,
      JSON.stringify(r.rules[0].conditions),
    );
    check('and it counts as narrowing an audience', r.stats.narrowedAudience === 1);
  }
  {
    const r = assemble(
      [rule({ key: 'r2', clauseId: 5, clauseNo: '12.3', title: 'daily reports' })],
      [mod({ fromClauseNo: '12.7', fromClauseId: 6, effect: 'exempt', targets: '12.3', condition: 'active_clients < 500' })],
      CLAUSES,
      VOCAB,
    );
    check(
      'exempt produces a NOT term, not another AND condition',
      /NOT \(active_clients < 500\)/.test(render(r.rules[0].applicability)),
      render(r.rules[0].applicability),
    );
    check(
      'and the result is no longer a plain conjunction, so it says so',
      r.rules[0].conditions === null,
      'a list of ANDed conditions cannot express "except"',
    );
  }
  {
    const r = assemble(
      [rule()],
      [mod({ fromClauseNo: '9.5.4', fromClauseId: 4, effect: 'extend_scope', condition: 'is_clearing_member == true' })],
      CLAUSES,
      VOCAB,
    );
    check(
      'extend_scope ORs, widening rather than narrowing',
      /\|\|/.test(render(r.rules[0].applicability)),
      render(r.rules[0].applicability),
    );
  }
  {
    const r = assemble(
      [rule()],
      [mod({ fromClauseNo: '18.9', fromClauseId: 8, effect: 'override_value', condition: 'is_qsb == true', overrideValue: '90' })],
      CLAUSES,
      VOCAB,
    );
    check(
      'override_value does NOT edit the original rule',
      r.rules[0].conditions?.join('|') === BROKERS.join('|'),
      JSON.stringify(r.rules[0].conditions),
    );
    check(
      'it produces a SECOND, narrower rule instead',
      r.derived.length === 1 &&
        r.derived[0].conditions.includes('is_qsb == true') &&
        r.derived[0].overrideValue === '90',
      JSON.stringify(r.derived),
    );
    check(
      'and the derived rule remembers which clause created it',
      r.derived[0].source === '18.9',
      'all brokers keep the 180-day rule; QSBs get a stricter one that overrides it',
    );
  }

  // ── the measured finding: most modifiers are not about the firm ───────────
  section('routing · a modifier condition is only allowed near the audience if it is about the FIRM');

  check('a firm property is recognised', isFirmCondition('is_qsb == true', VOCAB));
  check('an invented property is not', !isFirmCondition('uses_t0_settlement == true', VOCAB));

  {
    // "Investment limits in 12.3.1 shall not be applicable on investments in
    // securitized debt instruments" — the INSTRUMENT is narrowed, not the firm.
    const r = assemble(
      [rule()],
      [mod({ effect: 'exempt', condition: '', scopeNote: 'investments in securitized debt instruments' })],
      CLAUSES,
      VOCAB,
    );
    check(
      'a scope condition never touches the audience',
      r.rules[0].conditions?.join('|') === BROKERS.join('|'),
      JSON.stringify(r.rules[0].conditions),
    );
    check(
      'it is carried as a precondition instead',
      r.rules[0].preconditions.length === 1 &&
        /securitized debt/.test(r.rules[0].preconditions[0].note),
      JSON.stringify(r.rules[0].preconditions),
    );
    check(
      'and the rule is marked for REVIEW rather than filed unrestricted',
      r.rules[0].needsReview,
      'filing it unrestricted applies it where it should not; dropping it loses a duty',
    );
    check(
      'the flag names the problem',
      r.flags.some((f) => f.kind === 'unexpressible_condition'),
      JSON.stringify(r.flags.map((f) => f.kind)),
    );
  }
  {
    // One modifier reaching many rules is ONE thing for a reviewer to decide.
    // The live run reported it 35 times before this.
    const r = assemble(
      [rule({ key: 'a' }), rule({ key: 'b' }), rule({ key: 'c' })],
      [mod({ effect: 'exempt', condition: '', scopeNote: 'securitized debt instruments' })],
      CLAUSES,
      VOCAB,
    );
    const flags = r.flags.filter((f) => f.kind === 'unexpressible_condition');
    check(
      'one modifier reaching three rules is ONE flag, listing all three',
      flags.length === 1 && flags[0].ruleKeys.length === 3,
      JSON.stringify(flags.map((f) => f.ruleKeys)),
    );
  }
  {
    // extend_scope by transaction type is NOT a review case: widening cannot
    // hide a duty from anyone.
    const r = assemble(
      [rule()],
      [mod({ effect: 'extend_scope', condition: '', scopeNote: "'switch in' transactions" })],
      CLAUSES,
      VOCAB,
    );
    check(
      'a scope EXTENSION is carried but does not force review',
      r.rules[0].preconditions.length === 1 && !r.rules[0].needsReview,
      'widening cannot hide a duty from anyone',
    );
  }
  {
    // The caller has to be able to tell a real narrowing from a rule that only
    // picked up a precondition. Without this the live run reported three
    // audiences narrowed on a document where none moved.
    const scoped = assemble(
      [rule()],
      [mod({ effect: 'exempt', condition: '', scopeNote: 'securitized debt' })],
      CLAUSES,
      VOCAB,
    );
    check(
      'a scope-only modifier leaves the audience exactly where Step 10 put it',
      scoped.rules[0].conditions?.join('|') === scoped.rules[0].baseConditions.join('|'),
      JSON.stringify([scoped.rules[0].conditions, scoped.rules[0].baseConditions]),
    );
    const firm = assemble([rule()], [mod()], CLAUSES, VOCAB);
    check(
      'a firm modifier moves it, and the base is kept so the move is visible',
      firm.rules[0].conditions?.join('|') !== firm.rules[0].baseConditions.join('|') &&
        firm.rules[0].baseConditions.join('|') === BROKERS.join('|'),
      JSON.stringify([firm.rules[0].conditions, firm.rules[0].baseConditions]),
    );
  }

  // ── Problem 3 · a modifier that modifies a modifier ───────────────────────
  section('Problem 3 · a modifier that modifies a modifier');

  {
    const r = assemble(
      [rule({ key: 'r2', clauseId: 5, clauseNo: '12.3', title: 'daily reports' })],
      [
        mod({ fromClauseNo: '12.7', fromClauseId: 6, effect: 'exempt', targets: '12.3', condition: 'active_clients < 500' }),
        // 12.9 targets 12.7 — a MODIFIER's clause, not a rule's.
        mod({ fromClauseNo: '12.9', fromClauseId: 7, effect: 'exempt', targets: '12.7', condition: 'holds_client_funds == true' }),
      ],
      CLAUSES,
      VOCAB,
    );
    const shown = render(r.rules[0].applicability);
    check(
      'the chained modifier narrows the EXEMPTION, not the rule',
      /NOT \(active_clients < 500 && NOT \(holds_client_funds == true\)\)/.test(shown),
      shown,
    );
    check(
      'every applied modification is recorded on the rule',
      r.rules[0].appliedFrom.includes('12.7') && r.rules[0].appliedFrom.includes('12.9'),
      JSON.stringify(r.rules[0].appliedFrom),
    );
    check(
      'and it is computed AND flagged — a double negative humans misread too',
      r.flags.some((f) => f.kind === 'chained_modification'),
      JSON.stringify(r.flags.map((f) => f.kind)),
    );
  }
  {
    const base: Applicability = {
      kind: 'and',
      terms: [
        { kind: 'base', conditions: BROKERS, source: '12.3' },
        { kind: 'not', source: '12.7', term: { kind: 'base', conditions: ['active_clients < 500'], source: '12.7' } },
      ],
    };
    check(
      'each term leaves a labelled handle for the next modifier to grab',
      findTerm(base, '12.7')?.kind === 'not',
      'chains work because every modification labels what it added',
    );
    check('a handle nobody added is not found', findTerm(base, '99.9') === null);
  }

  // ── the edge cases ────────────────────────────────────────────────────────
  section('edge cases');

  {
    const r = assemble([rule()], [mod({ targets: '77.7' })], CLAUSES, VOCAB);
    check(
      'an orphaned modifier is flagged, not dropped silently',
      r.flags.some((f) => f.kind === 'orphaned_modifier') && r.stats.orphaned === 1,
      'a second independent signal of upstream loss, alongside the numbering audit',
    );
    check('and it changes nothing about the rule', r.rules[0].conditions?.join('|') === BROKERS.join('|'));
  }
  {
    // 9.5.1 produced TWO duties. Does "9.5.1 applies only when..." restrict both?
    const r = assemble(
      [rule({ key: 'a' }), rule({ key: 'b', title: 'audit by a CERT-In auditor' })],
      [mod()],
      CLAUSES,
      VOCAB,
    );
    check(
      'a modifier on a clause that produced two rules applies to both',
      r.rules.every((x) => x.conditions?.includes('active_clients > 5000')),
      'the modifier cites the CLAUSE — the only unit it can name',
    );
    check(
      'and that is flagged for confirmation ONCE, not once per rule',
      r.flags.filter((f) => f.kind === 'multi_rule_target').length === 1,
      JSON.stringify(r.flags.map((f) => f.kind)),
    );
  }
  {
    const r = assemble(
      [rule()],
      [
        mod({ fromClauseNo: '18.9', fromClauseId: 8, effect: 'override_value', condition: 'is_qsb == true', overrideValue: '90' }),
        mod(),
      ],
      CLAUSES,
      VOCAB,
    );
    check(
      'override_value is applied LAST, so it sees what the others produced',
      r.derived[0].conditions.includes('active_clients > 5000'),
      JSON.stringify(r.derived[0].conditions),
    );
  }
  {
    const r = assemble([rule({ audienceConditions: [] })], [], CLAUSES, VOCAB);
    check('a rule nothing modifies passes straight through', r.stats.applied === 0 && r.rules.length === 1);
  }

  // ── flatten and render ────────────────────────────────────────────────────
  section('flatten · what the fingerprint is allowed to see');

  check(
    'a conjunction flattens, sorted and de-duplicated',
    flatten({
      kind: 'and',
      terms: [
        { kind: 'base', conditions: ['b == 1'], source: 'x' },
        { kind: 'base', conditions: ['a == 1', 'b == 1'], source: 'y' },
      ],
    })?.join('|') === 'a == 1|b == 1',
  );
  check(
    'a NOT does NOT flatten — it returns null rather than an approximation',
    flatten({ kind: 'not', source: 'x', term: { kind: 'base', conditions: ['a == 1'], source: 'x' } }) === null,
    'a hash built from an applicability that is not the rule\'s would be a hash of something untrue',
  );
  check(
    'an OR does not flatten either',
    flatten({
      kind: 'or',
      terms: [
        { kind: 'base', conditions: ['a == 1'], source: 'x' },
        { kind: 'base', conditions: ['b == 1'], source: 'y' },
      ],
    }) === null,
  );

  // ── the acceptance line ───────────────────────────────────────────────────
  section('acceptance');

  {
    const before = identity(BROKERS, 'days_since(x) <= 180');
    const r = assemble([rule()], [mod()], CLAUSES, VOCAB);
    const after = identity(r.rules[0].conditions, 'days_since(x) <= 180');
    check(
      'a modifier measurably narrows its target rule\'s audience',
      r.rules[0].conditions?.length === 2 &&
        r.rules[0].conditions.includes('active_clients > 5000'),
      `${BROKERS.join(' && ')}  →  ${render(r.rules[0].applicability)}`,
    );
    check(
      'and the identity hash is computed AFTER, not before',
      before !== after,
      `${before} → ${after} — fingerprinting first would make this a phantom amendment`,
    );
    check(
      'assembly is what changed it — the shape is identical either side',
      identity(BROKERS, 'days_since(x) <= 180') === before,
      'only the applicability moved',
    );
  }

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
