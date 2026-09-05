/**
 * M3 — attribute funnel tests (run: `npm run test:m3`).
 *
 * Drives the REAL AttributeResolverService against an in-memory stand-in for the
 * `attributes` table, so the funnel's decisions are exercised with *controlled*
 * distances. This matters: under the mock pseudo-embeddings the live pipeline uses,
 * cosine distance is random noise, so the 0.15/0.45 bands can only be tested by
 * supplying vectors deliberately — which is exactly what this does.
 *
 * Covers the three acceptance tests in TASKS.md M3:
 *   1. dedup            — audit_last_date reuses last_audit_date (dist < 0.15)
 *   2. false-merge guard — same token name, different meaning → tripwire → judge
 *                          → "different" → two attributes
 *   3. one attribute      — the 182-day and 91-day versions of one duty resolve
 *                          to the SAME attribute, and emit the same ref->id map
 *
 * The identity/full hash assertions that used to live here moved to Step 14
 * (`python tools/fingerprint_check.py`): canonicalisation is a tree rewrite and
 * needs the audience id, so the funnel no longer computes it.
 */

import 'reflect-metadata';
import { AttributeResolverService, ResolveStats } from '../src/ingestion/attribute-resolver.service';
import { AiRule } from '../src/ingestion/ai-client.service';

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

// ── in-memory `attributes` table ─────────────────────────────────────────────
interface FakeAttr {
  id: number;
  category: string;
  canonical_name: string;
  data_type: string;
  unit: string | null;
  description: string;
  aliases: string[];
  vector: number[] | null;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

class FakeAttrRepo {
  rows: FakeAttr[] = [];
  private nextId = 1;

  create(obj: Record<string, unknown>) {
    return { ...obj };
  }

  async save(obj: Record<string, unknown>) {
    const row: FakeAttr = {
      id: this.nextId++,
      category: String(obj.category),
      canonical_name: String(obj.canonicalName),
      data_type: String(obj.dataType),
      unit: (obj.unit as string) ?? null,
      description: String(obj.description ?? ''),
      aliases: (obj.aliases as string[]) ?? [],
      vector: null,
    };
    this.rows.push(row);
    return { ...obj, id: row.id };
  }

  async query(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
    // vector search
    if (sql.includes('ORDER BY embedding')) {
      const probe = JSON.parse(String(params[0])) as number[];
      return this.rows
        .filter((r) => r.vector)
        .map((r) => ({
          id: r.id,
          category: r.category,
          canonical_name: r.canonical_name,
          aliases: r.aliases,
          description: r.description,
          distance: cosineDistance(probe, r.vector as number[]),
        }))
        .sort((a, b) => (a.distance as number) - (b.distance as number))
        .slice(0, 5);
    }
    // same-name tripwire
    if (sql.includes('canonical_name = $1 OR $1 = ANY(aliases)')) {
      const token = String(params[0]);
      const hit = this.rows.find((r) => r.canonical_name === token || r.aliases.includes(token));
      return hit
        ? [
            {
              id: hit.id,
              category: hit.category,
              canonical_name: hit.canonical_name,
              aliases: hit.aliases,
              description: hit.description,
            },
          ]
        : [];
    }
    // alias append (provenance)
    if (sql.includes('array_append')) {
      const [id, token] = [Number(params[0]), String(params[1])];
      const row = this.rows.find((r) => r.id === id);
      if (row && row.canonical_name !== token && !row.aliases.includes(token)) {
        row.aliases.push(token);
      }
      return [];
    }
    // embedding write-back
    if (sql.includes('SET embedding')) {
      const [vec, id] = [JSON.parse(String(params[0])) as number[], Number(params[1])];
      const row = this.rows.find((r) => r.id === id);
      if (row) row.vector = vec;
      return [];
    }
    throw new Error(`FakeAttrRepo: unhandled SQL: ${sql.slice(0, 80)}`);
  }
}

// ── stub AI client: the judge verdict is scripted per test ───────────────────
class FakeAi {
  verdict: { match_index: number; same: boolean } = { match_index: -1, same: false };
  calls: { token: string; candidates: number }[] = [];

  async judgeAttribute(
    token: { name: string; meaning: string; topic: string },
    candidates: { id: number }[],
  ) {
    this.calls.push({ token: token.name, candidates: candidates.length });
    return { ...this.verdict, reason: 'scripted', confidence: 0.9, judge: 'stub' };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** unit vector whose cosine similarity to [1,0,0] is exactly `cos`. */
function vecAtCosine(cos: number): number[] {
  return [cos, Math.sqrt(Math.max(0, 1 - cos * cos)), 0];
}
const BASE = [1, 0, 0];

function rule(expression: string, hints: Record<string, { data_type: string; meaning: string }>, context: string): AiRule {
  return {
    title: 't',
    rule_expression: expression,
    result_pass: 'Compliant',
    result_fail: 'Non-Compliant',
    attribute_hints: hints,
    obligation_type: 'computable',
    context,
    source_clause: '1',
    confidence: 0.9,
    ast: { valid: true, functions: [], identifiers: [], literals: [], error: null },
  };
}

function freshStats(): ResolveStats {
  return { tokens: 0, reused: 0, created: 0, judged: 0, tripwired: 0, typeGated: 0 };
}

// ── tests ────────────────────────────────────────────────────────────────────

async function main() {
  // ═══ Test 1: cold start → NEW, rewrite + fingerprints ═════════════════════
  console.log('\nTest 1 — cold start creates the attribute and rewrites the rule');
  {
    const repo = new FakeAttrRepo();
    const ai = new FakeAi();
    const svc = new AttributeResolverService(repo as never, ai as never);
    const stats = freshStats();

    const r = rule(
      'days_since(last_audit_date) <= 182',
      { last_audit_date: { data_type: 'date', meaning: 'date the broker last completed a cyber security audit' } },
      'cybersecurity_audit',
    );
    const composite = AttributeResolverService.composite(
      'last_audit_date',
      r.attribute_hints.last_audit_date.meaning,
      'cybersecurity_audit',
    );
    const vecs = new Map([[composite, BASE]]);
    const out = await svc.resolve('doc1', r, undefined, vecs, new Map(), stats);

    check('creates one attribute', stats.created === 1 && repo.rows.length === 1);
    check('no AI judge on a cold start', ai.calls.length === 0);
    check(
      'rewrites to the canonical ref',
      out.canonicalExpression === 'days_since([cybersecurity_audit.last_audit_date]) <= 182',
      out.canonicalExpression,
    );
    check('links the attribute id', JSON.stringify(out.attributeIds) === '[1]');
    check(
      'emits the ref -> id map Step 14 fingerprints with',
      out.refIds['cybersecurity_audit.last_audit_date'] === 1,
      JSON.stringify(out.refIds),
    );
  }

  // ═══ Test 2: dedup — different spelling, same meaning → REUSE, no AI ═══════
  console.log('\nTest 2 — dedup: audit_last_date reuses last_audit_date (dist < 0.15)');
  {
    const repo = new FakeAttrRepo();
    const ai = new FakeAi();
    const svc = new AttributeResolverService(repo as never, ai as never);
    const memo = new Map();
    const stats = freshStats();

    // seed the registry with the cyber-audit attribute
    const first = rule(
      'days_since(last_audit_date) <= 182',
      { last_audit_date: { data_type: 'date', meaning: 'date the broker last completed a cyber security audit' } },
      'cybersecurity_audit',
    );
    const c1 = AttributeResolverService.composite('last_audit_date', first.attribute_hints.last_audit_date.meaning, 'cybersecurity_audit');
    await svc.resolve('doc1', first, undefined, new Map([[c1, BASE]]), memo, stats);

    // a later circular spells it differently, but means the same thing (dist 0.05)
    ai.verdict = { match_index: -1, same: false }; // if the judge is consulted, it would say "new"
    const second = rule(
      'months_since(audit_last_date) <= 6',
      { audit_last_date: { data_type: 'date', meaning: 'the date on which the last cyber security audit was carried out' } },
      'cybersecurity_audit',
    );
    const c2 = AttributeResolverService.composite('audit_last_date', second.attribute_hints.audit_last_date.meaning, 'cybersecurity_audit');
    const before = ai.calls.length;
    const out = await svc.resolve('doc2', second, undefined, new Map([[c2, vecAtCosine(0.95)]]), memo, stats);

    check('no second attribute created', repo.rows.length === 1, `rows=${repo.rows.length}`);
    check('reused without asking the AI', ai.calls.length === before);
    check(
      'rewrites the new spelling to the ORIGINAL canonical name',
      out.canonicalExpression === 'months_since([cybersecurity_audit.last_audit_date]) <= 6',
      out.canonicalExpression,
    );
    check('records the new spelling as an alias (provenance)', repo.rows[0].aliases.includes('audit_last_date'), JSON.stringify(repo.rows[0].aliases));
  }

  // ═══ Test 3: false-merge guard — same NAME, different meaning ═════════════
  console.log('\nTest 3 — false-merge guard: same name, different duty → two attributes');
  {
    const repo = new FakeAttrRepo();
    const ai = new FakeAi();
    const svc = new AttributeResolverService(repo as never, ai as never);
    const memo = new Map();
    const stats = freshStats();

    const first = rule(
      'days_since(last_audit_date) <= 182',
      { last_audit_date: { data_type: 'date', meaning: 'date the broker last completed a cyber security audit' } },
      'cybersecurity_audit',
    );
    const c1 = AttributeResolverService.composite('last_audit_date', first.attribute_hints.last_audit_date.meaning, 'cybersecurity_audit');
    await svc.resolve('doc1', first, undefined, new Map([[c1, BASE]]), memo, stats);

    // another circular: SAME token name, but a statutory financial audit
    ai.verdict = { match_index: -1, same: false }; // judge: different data-point
    const second = rule(
      'days_since(last_audit_date) <= 365',
      { last_audit_date: { data_type: 'date', meaning: 'date of the last statutory financial audit of the books of accounts' } },
      'financial_reporting',
    );
    const c2 = AttributeResolverService.composite('last_audit_date', second.attribute_hints.last_audit_date.meaning, 'financial_reporting');
    const out = await svc.resolve('doc2', second, undefined, new Map([[c2, vecAtCosine(0.99)]]), memo, stats);

    check('the same-name tripwire fired', stats.tripwired === 1);
    check('the judge was consulted (never a silent merge)', ai.calls.length === 1);
    check('two separate attributes now exist', repo.rows.length === 2, `rows=${repo.rows.length}`);
    check(
      'the new rule points at the NEW attribute, not the cyber one',
      JSON.stringify(out.attributeIds) === '[2]',
      JSON.stringify(out.attributeIds),
    );
    check(
      'same name, different category',
      repo.rows[0].canonical_name === repo.rows[1].canonical_name &&
        repo.rows[0].category !== repo.rows[1].category,
    );
    check(
      'a near-identical vector did NOT cause a silent reuse',
      stats.created === 2,
      `created=${stats.created}`,
    );
  }

  // ═══ Test 4: judge band → judge says "same" → reuse ═══════════════════════
  console.log('\nTest 4 — middle band (0.15–0.45) defers to the judge');
  {
    const repo = new FakeAttrRepo();
    const ai = new FakeAi();
    const svc = new AttributeResolverService(repo as never, ai as never);
    const memo = new Map();
    const stats = freshStats();

    const first = rule(
      'days_since(last_audit_date) <= 182',
      { last_audit_date: { data_type: 'date', meaning: 'date the broker last completed a cyber security audit' } },
      'cybersecurity_audit',
    );
    const c1 = AttributeResolverService.composite('last_audit_date', first.attribute_hints.last_audit_date.meaning, 'cybersecurity_audit');
    await svc.resolve('doc1', first, undefined, new Map([[c1, BASE]]), memo, stats);

    ai.verdict = { match_index: 0, same: true }; // judge: same data-point
    const second = rule(
      'months_since(cyber_audit_completed_on) <= 6',
      { cyber_audit_completed_on: { data_type: 'date', meaning: 'when the information-security audit was last signed off' } },
      'cybersecurity_audit',
    );
    const c2 = AttributeResolverService.composite('cyber_audit_completed_on', second.attribute_hints.cyber_audit_completed_on.meaning, 'cybersecurity_audit');
    const out = await svc.resolve('doc2', second, undefined, new Map([[c2, vecAtCosine(0.7)]]), memo, stats); // dist 0.30

    check('the judge was consulted', ai.calls.length === 1);
    check('no new attribute created', repo.rows.length === 1, `rows=${repo.rows.length}`);
    check('reused the existing attribute', JSON.stringify(out.attributeIds) === '[1]');
    check('alias recorded', repo.rows[0].aliases.includes('cyber_audit_completed_on'));
  }

  // ═══ Test 5: one duty, two deadlines — the funnel dedups ══════════════════
  console.log('\nTest 5 — one duty, two deadlines: the funnel reuses one attribute');
  {
    const repo = new FakeAttrRepo();
    const ai = new FakeAi();
    const svc = new AttributeResolverService(repo as never, ai as never);
    const memo = new Map();
    const stats = freshStats();

    const hint = { data_type: 'date', meaning: 'date the broker last completed a cyber security audit' };
    const composite = AttributeResolverService.composite('last_audit_date', hint.meaning, 'cybersecurity_audit');
    const vecs = new Map([[composite, BASE]]);

    const general = await svc.resolve('doc1', rule('days_since(last_audit_date) <= 182', { last_audit_date: hint }, 'cybersecurity_audit'), undefined, vecs, memo, stats);
    const qsb = await svc.resolve('doc2', rule('days_since(last_audit_date) <= 91', { last_audit_date: hint }, 'cybersecurity_audit'), undefined, vecs, memo, stats);

    check(
      'both rules resolve to one attribute',
      repo.rows.length === 1,
    );
    check(
      'and both emit the same ref -> id map',
      JSON.stringify(general.refIds) === JSON.stringify(qsb.refIds),
      JSON.stringify(general.refIds),
    );

    // a genuinely different duty must NOT share the attribute
    ai.verdict = { match_index: -1, same: false };
    const otherHint = { data_type: 'number', meaning: 'net worth of the broker in rupees' };
    const otherComposite = AttributeResolverService.composite('net_worth_value', otherHint.meaning, 'net_worth');
    const other = await svc.resolve(
      'doc3',
      rule('net_worth_value >= 182', { net_worth_value: otherHint }, 'net_worth'),
      undefined,
      new Map([[otherComposite, [0, 1, 0]]]),
      memo,
      stats,
    );
    check(
      'a different duty resolves to a different attribute id',
      JSON.stringify(other.attributeIds) !== JSON.stringify(general.attributeIds),
    );

    // The identity/full hash assertions that used to live here moved to Step 14
    // (`python tools/fingerprint_check.py`). They were testing a fingerprint the
    // funnel no longer computes: canonicalisation is a TREE rewrite and needs
    // the audience id, neither of which exists at this point in the pipeline.
    // Keeping a copy here would have meant a second implementation to drift.
  }

  // ── summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(64)}`);
  if (failures.length) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed:`);
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log(`PASSED — all ${passed} assertions green.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
