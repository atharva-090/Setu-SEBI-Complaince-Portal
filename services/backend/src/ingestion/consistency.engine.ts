/**
 * Step 17 — consistency checks.
 *
 * Steps 1–16 produce a filed, linked graph. This asks the question nothing
 * before it could: **does the graph agree with itself?** It is only possible
 * because Step 10 made audiences machine-readable, Step 13 made data-points
 * canonical, and Step 15 put both in one graph.
 *
 * ⚠️ A CONTRADICTION IS USUALLY OUR BUG, NOT SEBI'S.
 *
 *     a mis-resolved audience                 (Step 10)
 *     two facts wrongly merged                (Step 13)
 *     a modifier applied to the wrong target  (Step 12)
 *     an unnormalised unit                    (Step 11)
 *
 * So this is not only a product feature — it is the pipeline's regression test,
 * and the only check in the system that can catch a Step 10 or Step 13 error
 * after the fact, because it compares rules against EACH OTHER rather than
 * against the document they came from. That is why it is built early.
 *
 * It reports. It never auto-fixes.
 */

import { Relation, compare } from './audience-resolver.service';

export type Family = 'CONTRADICTION' | 'DEAD_RULE' | 'REDUNDANCY' | 'INTEGRITY';
export type Severity = 'high' | 'medium' | 'low';

/** One numeric constraint, extracted by the canonicaliser (canonical.py). */
export interface Constraint {
  attribute_ids: number[];
  /** Serialised left-hand side. Only identical shapes are comparable. */
  shape: string;
  op: '<' | '<=' | '>' | '>=' | '==' | '!=';
  value: number;
}

export interface CheckedRule {
  id: number;
  title: string;
  state: string;
  identityHash: string | null;
  audienceId: number | null;
  attributeIds: number[];
  constraints: Constraint[];
  sourceSpans: unknown[];
  docIds: string[];
}

export interface CheckedAudience {
  id: number;
  label: string;
  /** Normalised conditions, as stored by Step 10. */
  conditions: string[];
  /** Step 10e — PROPOSED until a human approves it. */
  state?: 'PROPOSED' | 'APPROVED';
}

export interface Finding {
  family: Family;
  severity: Severity;
  rules: number[];
  message: string;
  /** Where to look first. A contradiction is usually a defect upstream. */
  likelyCause: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interval arithmetic on a single attribute
//
// ⚠️ Deliberately NOT general satisfiability. That is an SMT problem: powerful,
// slow, and capable of producing findings nobody can act on. Real regulatory
// contradictions are almost always two different numbers for the same duty —
// two deadlines, two thresholds, two frequencies.
// ─────────────────────────────────────────────────────────────────────────────
interface Interval {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
}

export function toInterval(c: Constraint): Interval | null {
  switch (c.op) {
    case '<':
      return { lo: -Infinity, hi: c.value, loOpen: false, hiOpen: true };
    case '<=':
      return { lo: -Infinity, hi: c.value, loOpen: false, hiOpen: false };
    case '>':
      return { lo: c.value, hi: Infinity, loOpen: true, hiOpen: false };
    case '>=':
      return { lo: c.value, hi: Infinity, loOpen: false, hiOpen: false };
    case '==':
      return { lo: c.value, hi: c.value, loOpen: false, hiOpen: false };
    default:
      return null; // != cannot make a range empty on its own
  }
}

/** Do these two demands have no value that satisfies both? */
export function conflicts(a: Constraint, b: Constraint): boolean {
  if (a.shape !== b.shape) return false; // different quantities, not comparable
  const x = toInterval(a);
  const y = toInterval(b);
  if (!x || !y) return false;
  const lo = Math.max(x.lo, y.lo);
  const hi = Math.min(x.hi, y.hi);
  if (lo > hi) return true;
  if (lo === hi) {
    const loOpen = (x.lo === lo && x.loOpen) || (y.lo === lo && y.loOpen);
    const hiOpen = (x.hi === hi && x.hiOpen) || (y.hi === hi && y.hiOpen);
    return loOpen || hiOpen;
  }
  return false;
}

/**
 * Do two audiences provably share firms?
 *
 * Lattice implication only. Two unrelated tests may well overlap in reality —
 * `is_qsb==true` and `holds_client_funds==true` certainly do — but that cannot
 * be PROVEN from the tests alone, and a contradiction reported on an unproven
 * overlap is a false positive aimed at a human. Conservative on purpose.
 */
export function audiencesOverlap(
  a: CheckedAudience | undefined,
  b: CheckedAudience | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  const relation: Relation = compare(a.conditions, b.conditions);
  return relation !== 'unrelated';
}

/**
 * Which rules are worth checking.
 *
 * The design frames a contradiction as two ACTIVE rules, and for the PRODUCT
 * that is right — a rule awaiting review is not yet a live duty. But Step 17 is
 * also the pipeline's regression test, and a rule sitting in REVIEW is one the
 * pipeline just produced: catching a mis-resolved audience BEFORE a human
 * approves it is strictly more useful than after.
 *
 * So both are checked, and findings that involve a rule which is not yet live
 * are reported one severity lower. SUPERSEDED rules are excluded outright —
 * a repealed duty contradicts nothing.
 */
export const CHECKED_STATES = new Set(['ACTIVE', 'REVIEW']);
export const isChecked = (r: { state: string }) => CHECKED_STATES.has(r.state);
const isLive = (r: { state: string }) => r.state === 'ACTIVE';

/** A finding about a not-yet-live rule is real, but not yet urgent. */
function gradeFor(rules: { state: string }[], top: Severity): Severity {
  if (rules.every(isLive)) return top;
  return top === 'high' ? 'medium' : 'low';
}

const rulesOf = (f: Finding) => f.rules.join(',');

/**
 * 1 · CONTRADICTION — two ACTIVE rules no single firm can satisfy.
 *
 * Cost control: pairwise comparison is O(n²), and at ~50,000 obligations that is
 * 2.5 billion pairs. But two rules can only contradict if they share an
 * ATTRIBUTE, so bucket by attribute id first. Most attributes appear in a
 * handful of rules, which collapses the work to near-linear.
 */
export function contradictions(
  rules: CheckedRule[],
  audiences: Map<number, CheckedAudience>,
): Finding[] {
  const buckets = new Map<number, CheckedRule[]>();
  for (const rule of rules) {
    if (!isChecked(rule) || rule.constraints.length === 0) continue;
    const keys = new Set(rule.constraints.flatMap((c) => c.attribute_ids));
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(rule);
      else buckets.set(key, [rule]);
    }
  }

  const found = new Map<string, Finding>();
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (!audiencesOverlap(audiences.get(a.audienceId ?? -1), audiences.get(b.audienceId ?? -1))) {
          continue;
        }
        for (const ca of a.constraints) {
          for (const cb of b.constraints) {
            if (!conflicts(ca, cb)) continue;
            const finding: Finding = {
              family: 'CONTRADICTION',
              severity: gradeFor([a, b], 'high'),
              rules: [a.id, b.id].sort((x, y) => x - y),
              message:
                `no firm can satisfy both: "${a.title.slice(0, 60)}" requires ` +
                `${ca.op} ${ca.value} while "${b.title.slice(0, 60)}" requires ` +
                `${cb.op} ${cb.value} on the same quantity`,
              likelyCause:
                a.audienceId === b.audienceId
                  ? 'same audience — suspect Step 13 (two facts wrongly merged) or Step 11 (unnormalised unit)'
                  : 'overlapping audiences — suspect Step 10 (a mis-resolved audience) or Step 12 (a modifier on the wrong target)',
            };
            found.set(rulesOf(finding), finding);
          }
        }
      }
    }
  }
  return [...found.values()];
}

/** 2 · DEAD RULE — a rule no firm can ever match. */
export function deadRules(
  rules: CheckedRule[],
  audiences: Map<number, CheckedAudience>,
): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    if (!isChecked(rule)) continue;

    // Its own constraints cannot both hold.
    for (let i = 0; i < rule.constraints.length; i++) {
      for (let j = i + 1; j < rule.constraints.length; j++) {
        if (conflicts(rule.constraints[i], rule.constraints[j])) {
          out.push({
            family: 'DEAD_RULE',
            severity: gradeFor([rule], 'high'),
            rules: [rule.id],
            message: `"${rule.title.slice(0, 60)}" demands ${rule.constraints[i].op} ${rule.constraints[i].value} and ${rule.constraints[j].op} ${rule.constraints[j].value} of the same quantity`,
            likelyCause: 'suspect Step 12 — a modifier applied to the wrong target',
          });
        }
      }
    }

    // Its audience selects nobody: the same property asserted two ways.
    const audience = audiences.get(rule.audienceId ?? -1);
    if (audience) {
      const byProperty = new Map<string, Set<string>>();
      for (const cond of audience.conditions) {
        const [name, op, ...rest] = cond.split(' ');
        if (op !== '==') continue;
        const values = byProperty.get(name) ?? new Set<string>();
        values.add(rest.join(' '));
        byProperty.set(name, values);
      }
      for (const [name, values] of byProperty) {
        if (values.size > 1) {
          out.push({
            family: 'DEAD_RULE',
            severity: gradeFor([rule], 'high'),
            rules: [rule.id],
            message: `audience "${audience.label}" requires ${name} to equal ${[...values].join(' and ')} at once — it selects no firm`,
            likelyCause: 'suspect Step 10 — an audience test built from contradictory conditions',
          });
        }
      }
    }

    if (rule.audienceId === null) {
      out.push({
        family: 'DEAD_RULE',
        severity: gradeFor([rule], 'medium'),
        rules: [rule.id],
        message: `"${rule.title.slice(0, 60)}" has no audience — nobody is on the hook for it`,
        likelyCause: 'suspect Step 10 — the clause never received an audience floor',
      });
    }
  }
  return out;
}

/**
 * 3 · REDUNDANCY — two rules saying the same thing.
 *
 * Two ACTIVE rules sharing an identity_hash is **exactly the silent duplicate
 * Step 15 could not catch**, arriving here to be caught. Subsumption is the
 * other half: a rule whose audience is strictly narrower than another's, with an
 * identical expression, adds nothing.
 */
export function redundancy(
  rules: CheckedRule[],
  audiences: Map<number, CheckedAudience>,
): Finding[] {
  const out: Finding[] = [];
  const byIdentity = new Map<string, CheckedRule[]>();
  for (const rule of rules) {
    if (!isChecked(rule) || !rule.identityHash) continue;
    const list = byIdentity.get(rule.identityHash);
    if (list) list.push(rule);
    else byIdentity.set(rule.identityHash, [rule]);
  }

  for (const [identity, group] of byIdentity) {
    if (group.length > 1) {
      out.push({
        family: 'REDUNDANCY',
        severity: gradeFor(group, 'medium'),
        rules: group.map((r) => r.id).sort((a, b) => a - b),
        message: `${group.length} live rules share identity ${identity.slice(0, 12)} — the same duty, stored more than once`,
        likelyCause:
          'suspect Step 15 — these were filed separately instead of as restatements of one another',
      });
      continue;
    }
  }

  // Subsumption: same expression shape, one audience strictly inside the other.
  const byShape = new Map<string, CheckedRule[]>();
  for (const rule of rules) {
    if (!isChecked(rule) || rule.constraints.length === 0) continue;
    const shape = rule.constraints
      .map((c) => `${c.shape}${c.op}${c.value}`)
      .sort()
      .join('&');
    const list = byShape.get(shape);
    if (list) list.push(rule);
    else byShape.set(shape, [rule]);
  }
  for (const group of byShape.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const a = audiences.get(group[i].audienceId ?? -1);
        const b = audiences.get(group[j].audienceId ?? -1);
        if (!a || !b || a.id === b.id) continue;
        if (compare(a.conditions, b.conditions) === 'narrower') {
          out.push({
            family: 'REDUNDANCY',
            severity: 'low',
            rules: [group[i].id, group[j].id],
            message: `"${a.label}" is inside "${b.label}" and both carry the same requirement — the narrower rule adds nothing`,
            likelyCause: 'suspect Step 10 — a chapter audience restating a document floor',
          });
        }
      }
    }
  }
  return out;
}

/** 4 · INTEGRITY — broken provenance and dangling references. */
export function integrity(
  rules: CheckedRule[],
  edges: { id: number; fromId: number; toId: number; type: string; state: string }[],
  audiences: Map<number, CheckedAudience> = new Map(),
): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(rules.map((r) => [r.id, r]));

  // Step 10e — a rule filed under an audience nobody approved.
  //
  // This is what makes the approval gate mean something without building a
  // blocking pipeline. Parsing and drafting deliberately do NOT wait for the
  // gate (the design is explicit: the gate must not block the expensive work),
  // so the check has to run afterwards, here, where it can see the whole graph.
  // Grouped per audience rather than per rule: 68 findings from one unapproved
  // audience are ONE thing to approve.
  const unapproved = new Map<number, number[]>();
  for (const rule of rules) {
    if (!isChecked(rule) || rule.audienceId === null) continue;
    const audience = audiences.get(rule.audienceId);
    if (!audience || audience.state !== 'PROPOSED') continue;
    const list = unapproved.get(rule.audienceId) ?? [];
    list.push(rule.id);
    unapproved.set(rule.audienceId, list);
  }
  for (const [audienceId, ruleIds] of unapproved) {
    const audience = audiences.get(audienceId) as CheckedAudience;
    out.push({
      family: 'INTEGRITY',
      severity: gradeFor(ruleIds.map((id) => byId.get(id) as CheckedRule), 'medium'),
      rules: ruleIds.slice(0, 25).sort((a, b) => a - b),
      message:
        `${ruleIds.length} rules are filed under "${audience.label.slice(0, 50)}" ` +
        `(${audience.conditions.join(' && ')}), an audience nobody has approved`,
      likelyCause: 'suspect Step 10e — the approval queue has not been worked',
    });
  }

  for (const rule of rules) {
    if (!rule.sourceSpans || rule.sourceSpans.length === 0) {
      out.push({
        family: 'INTEGRITY',
        severity: 'high',
        rules: [rule.id],
        // Without a span there is no way to show an auditor where the duty came
        // from, which is the whole claim of the product.
        message: `"${rule.title.slice(0, 60)}" has no source span — it cannot be traced to a document`,
        likelyCause: 'suspect Step 15 — filed without provenance',
      });
    }
  }

  for (const edge of edges) {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (!from || !to) {
      out.push({
        family: 'INTEGRITY',
        severity: 'medium',
        rules: [edge.fromId, edge.toId],
        message: `${edge.type} edge ${edge.id} points at a rule that does not exist`,
        likelyCause: 'suspect Step 16 — a link resolved against a rule that was later replaced',
      });
      continue;
    }
    if (to.state === 'SUPERSEDED' && edge.state === 'ACTIVE') {
      out.push({
        family: 'INTEGRITY',
        severity: 'medium',
        rules: [edge.fromId, edge.toId],
        message: `${edge.type} edge ${edge.id} still points at a SUPERSEDED rule`,
        likelyCause: 'suspect Step 16 — edges were not revisited after a repeal',
      });
    }
  }

  // Cycles in depends_on. Step 16 should have refused these.
  const graph = new Map<number, number[]>();
  for (const e of edges) {
    if (e.type !== 'depends_on') continue;
    const list = graph.get(e.fromId);
    if (list) list.push(e.toId);
    else graph.set(e.fromId, [e.toId]);
  }
  const state = new Map<number, number>(); // 0 visiting, 1 done
  const cycle: number[] = [];
  const walk = (node: number): boolean => {
    if (state.get(node) === 0) return true;
    if (state.get(node) === 1) return false;
    state.set(node, 0);
    for (const next of graph.get(node) ?? []) {
      if (walk(next)) {
        cycle.push(node);
        return true;
      }
    }
    state.set(node, 1);
    return false;
  };
  for (const node of graph.keys()) {
    if (state.has(node)) continue;
    if (walk(node)) {
      out.push({
        family: 'INTEGRITY',
        severity: 'high',
        rules: [...new Set(cycle)],
        message: `depends_on cycle: ${[...new Set(cycle)].join(' → ')}`,
        likelyCause: 'suspect Step 16 — a dependency loop that should have been refused',
      });
      break;
    }
  }

  return out;
}

export interface Report {
  findings: Finding[];
  counts: Record<Family, number>;
  /** Findings grouped by the step they most likely came from. */
  byLikelyCause: { cause: string; count: number; rules: number[] }[];
  checked: { rules: number; checked: number; live: number; withConstraints: number };
}

export function runChecks(
  rules: CheckedRule[],
  audiences: Map<number, CheckedAudience>,
  edges: { id: number; fromId: number; toId: number; type: string; state: string }[] = [],
): Report {
  const findings = [
    ...contradictions(rules, audiences),
    ...deadRules(rules, audiences),
    ...redundancy(rules, audiences),
    ...integrity(rules, edges, audiences),
  ];

  const counts: Record<Family, number> = {
    CONTRADICTION: 0,
    DEAD_RULE: 0,
    REDUNDANCY: 0,
    INTEGRITY: 0,
  };
  for (const f of findings) counts[f.family] += 1;

  // Clustered by root cause, because 400 findings from one bad audience is ONE
  // problem to fix, not 400.
  const clusters = new Map<string, number[]>();
  for (const f of findings) {
    const list = clusters.get(f.likelyCause) ?? [];
    list.push(...f.rules);
    clusters.set(f.likelyCause, list);
  }

  const checkedRules = rules.filter(isChecked);
  const live = rules.filter(isLive);
  return {
    findings,
    counts,
    byLikelyCause: [...clusters.entries()]
      .map(([cause, ruleIds]) => ({
        cause,
        count: ruleIds.length,
        rules: [...new Set(ruleIds)].slice(0, 10),
      }))
      .sort((a, b) => b.count - a.count),
    checked: {
      rules: rules.length,
      // `checked` is what was actually examined; `live` is the subset that is a
      // duty today. They differ whenever rules are awaiting review, and
      // collapsing them would let a vacuous run report a clean bill of health.
      checked: checkedRules.length,
      live: live.length,
      withConstraints: checkedRules.filter((r) => r.constraints.length > 0).length,
    },
  };
}
