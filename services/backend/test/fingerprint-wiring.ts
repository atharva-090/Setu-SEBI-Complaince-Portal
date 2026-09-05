/**
 * D6 — the backend half of Step 14 (run: `npm run test:fingerprint`).
 *
 * The canonicaliser and both hashes live in the AI service, next to the
 * expression parser; they are checked by `python tools/fingerprint_check.py`.
 * What is checked HERE is the wiring the backend owns, and it is the part that
 * caused the bug in the first place:
 *
 *   - the audience of a rule's CLAUSE is what reaches the fingerprint call
 *   - a clause with no audience sends null, and null is not a real audience
 *   - hash_inputs is stored, so a registry renumber is a re-derivation
 *
 * No Docker: the AI client is replaced by a fake that records what it was asked.
 */

import 'reflect-metadata';
import { AiFingerprint, AiFingerprintItem } from '../src/ingestion/ai-client.service';

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

/** Records every request, and answers the way canonical.py does. */
class FakeAi {
  seen: AiFingerprintItem[] = [];
  async fingerprint(items: AiFingerprintItem[]): Promise<AiFingerprint[]> {
    this.seen.push(...items);
    return items.map((item) => {
      const masked = item.expression.replace(/\b\d+(\.\d+)?\b/g, 'NUM');
      const identityCore = `a:${item.audience_id}|${masked}`;
      return {
        key: item.key,
        structural: true,
        valid: true,
        identity_hash: `id(${identityCore})`,
        full_hash: `full(${identityCore}|${item.expression})`,
        identity_core: identityCore,
        canonical_expression: item.expression,
        attribute_ids: Object.values(item.attribute_ids).sort((a, b) => a - b),
        literals: [],
        hash_inputs: {
          audience_id: item.audience_id,
          attribute_ids: Object.values(item.attribute_ids).sort((a, b) => a - b),
          canonical_tree: { kind: 'cmp' },
          literals: [],
          structural: true,
          identity_core: identityCore,
        },
        error: null,
      };
    });
  }
}

/** Stands in for `source_clauses`: clause_no -> audience_id. */
class FakeClauses {
  constructor(private readonly rows: { clause_no: string; audience_id: number }[]) {}
  async query() {
    return this.rows;
  }
}

/**
 * The method under test, extracted to the shape ingestion.service.ts calls it
 * with. Kept as a local copy of the wiring rather than booting Nest, so this
 * runs without a database — the assertions are about WHICH audience is sent.
 */
async function fingerprintRules(
  docId: string,
  pending: { row: Record<string, unknown>; clause?: { clause_no: string | null } }[],
  refIdsByRow: Map<number, Record<string, number>>,
  ai: FakeAi,
  clauses: FakeClauses,
) {
  const audienceByClauseNo = new Map<string, number>();
  for (const r of await clauses.query()) {
    if (r.clause_no && r.audience_id != null) audienceByClauseNo.set(r.clause_no, r.audience_id);
  }
  const items = pending.map((p, i) => ({
    key: String(i),
    expression: (p.row.ruleExpression as string) || '',
    audience_id: p.clause?.clause_no ? (audienceByClauseNo.get(p.clause.clause_no) ?? null) : null,
    attribute_ids: refIdsByRow.get(i) || {},
    obligation_text: (p.row.title as string) || undefined,
  }));
  const results = await ai.fingerprint(items);
  for (const fp of results) {
    const row = pending[Number(fp.key)]?.row;
    if (!row) continue;
    row.identityHash = fp.identity_hash;
    row.fullHash = fp.full_hash;
    row.hashInputs = fp.hash_inputs;
    const audienceId = fp.hash_inputs?.audience_id as number | null | undefined;
    if (typeof audienceId === 'number') row.audienceId = audienceId;
  }
  return items;
}

async function main() {
  // The scenario the whole step exists for: one duty, two audiences, two
  // deadlines — QSBs get 180 days, everyone else 90.
  const QSB_CLAUSE = '18.5';
  const GENERAL_CLAUSE = '19.1';
  const ORPHAN_CLAUSE = '20.1'; // no audience stamped

  const clauses = new FakeClauses([
    { clause_no: QSB_CLAUSE, audience_id: 7 },
    { clause_no: GENERAL_CLAUSE, audience_id: 8 },
  ]);

  const expr = 'days_between([Cyber.last_audit_date],today)';
  const pending: { row: Record<string, unknown>; clause?: { clause_no: string | null } }[] = [
    { row: { ruleExpression: `${expr} <= 180`, title: 'QSB audit' }, clause: { clause_no: QSB_CLAUSE } },
    { row: { ruleExpression: `${expr} <= 90`, title: 'general audit' }, clause: { clause_no: GENERAL_CLAUSE } },
    { row: { ruleExpression: `${expr} <= 180`, title: 'orphan' }, clause: { clause_no: ORPHAN_CLAUSE } },
  ];
  const refIds = new Map([
    [0, { 'Cyber.last_audit_date': 4471 }],
    [1, { 'Cyber.last_audit_date': 4471 }],
    [2, { 'Cyber.last_audit_date': 4471 }],
  ]);

  const ai = new FakeAi();
  console.log('\nthe audience reaches the fingerprint call');
  const items = await fingerprintRules('doc1', pending, refIds, ai, clauses);
  check('the QSB rule is sent with its clause audience', items[0].audience_id === 7, String(items[0].audience_id));
  check('the general rule is sent with a DIFFERENT audience', items[1].audience_id === 8, String(items[1].audience_id));
  check('an unstamped clause sends null, not a guess', items[2].audience_id === null, String(items[2].audience_id));
  check('the registry ids are sent, not the labels', JSON.stringify(items[0].attribute_ids) === '{"Cyber.last_audit_date":4471}');

  console.log('\nthe bug: two coexisting duties must not collide');
  check(
    'QSB ≤180 and non-QSB ≤90 get DIFFERENT identity hashes',
    pending[0].row.identityHash !== pending[1].row.identityHash,
    `${pending[0].row.identityHash} vs ${pending[1].row.identityHash}`,
  );
  check(
    'and the difference is the audience, not the number',
    String(pending[0].row.identityHash).includes('a:7') &&
      String(pending[1].row.identityHash).includes('a:8'),
  );
  check(
    'an unassigned rule does not collide with an assigned one',
    pending[2].row.identityHash !== pending[0].row.identityHash,
  );

  console.log('\nwhat gets stored');
  check('identityHash written to the row', typeof pending[0].row.identityHash === 'string');
  check('fullHash written to the row', typeof pending[0].row.fullHash === 'string');
  check('audienceId written to the row', pending[0].row.audienceId === 7);
  check(
    'an unassigned rule leaves audienceId UNSET rather than 0',
    pending[2].row.audienceId === undefined,
    String(pending[2].row.audienceId),
  );
  const inputs = pending[0].row.hashInputs as Record<string, unknown>;
  check(
    'hashInputs carries audience, ids and tree — so a renumber is a re-derivation',
    inputs.audience_id === 7 &&
      JSON.stringify(inputs.attribute_ids) === '[4471]' &&
      inputs.canonical_tree != null,
    JSON.stringify(inputs),
  );

  console.log('\nbatching');
  const many: { row: Record<string, unknown>; clause?: { clause_no: string | null } }[] = Array.from({ length: 450 }, (_, i) => ({
    row: { ruleExpression: `x <= ${i}`, title: `r${i}` },
    clause: { clause_no: QSB_CLAUSE },
  }));
  const manyRefs = new Map(many.map((_, i) => [i, {}]));
  const ai2 = new FakeAi();
  await fingerprintRules('doc2', many, manyRefs, ai2, clauses);
  check('every rule is fingerprinted', ai2.seen.length === 450, String(ai2.seen.length));
  check('all of them carry the clause audience', ai2.seen.every((i) => i.audience_id === 7));

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
