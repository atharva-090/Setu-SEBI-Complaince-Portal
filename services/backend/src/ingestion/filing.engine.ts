/**
 * Step 15 — filing.
 *
 * This is where a rule meets the graph. Everything before it turns prose into a
 * well-formed rule; here we decide whether that rule is new, a repetition of
 * something already known, or a change to a live obligation.
 *
 * ── The one structural decision ──────────────────────────────────────────────
 *
 * Filing does NOT mutate the graph. It appends an immutable assertion:
 *
 *     document D asserts rule R, effective E, verdict V
 *
 * and the live graph is a PROJECTION — replay the log in effective-date order.
 *
 * The reason is that amendments only mean anything in effective-date order, and
 * documents do not arrive in that order:
 *
 *     ingest the 2026 amendment first  →  no match    →  files as NEW
 *     ingest the 2023 original second  →  identity ✓  →  files as an AMENDMENT
 *                                                        moving 90 back to 180
 *     The graph says 180. SEBI says 90. No error was raised.
 *
 * Sorting the corpus by effective date fixes the bulk load and fails in the
 * steady state, because circulars apply retroactively: a document arriving in
 * March can be effective from January, after statuses were already computed.
 *
 * This is not new architecture — it is Layer C's rule (the graph is recomputed,
 * never edited) applied one level up, and Layer C was built disposable precisely
 * so this is cheap. It also buys "what did we believe on 12 March?", which has
 * no answer without an event log.
 *
 * Everything in this file is PURE. The database layer is a thin wrapper around
 * it, so the whole decision surface can be tested without Docker.
 */

export type Verdict = 'restatement' | 'amendment' | 'new' | 'repeal' | 'ambiguous';
export type Lane = 'fingerprint' | 'citation' | 'fuzzy';

/** A citation carried by an incoming rule. Extraction itself is Step 16 (D8);
 *  filing only consumes what it is given. */
export interface Citation {
  kind: 'amends' | 'supersedes' | 'repeals' | 'depends_on';
  /** Identity of the rule being pointed at, once Step 16 has resolved it. */
  targetIdentityHash?: string;
  targetDoc?: string;
  targetClauseNo?: string;
  raw: string;
}

export interface IncomingRule {
  /** Stable key within its document — used to correlate results back to rows. */
  key: string;
  docId: string;
  clauseNo?: string | null;
  identityHash: string;
  fullHash: string;
  audienceId: number | null;
  attributeIds: number[];
  /** ISO date. Replay order — the date the rule TAKES EFFECT, not ingestion. */
  effectiveFrom: string;
  citations?: Citation[];
  title?: string;
  payload?: Record<string, unknown>;
}

/** One rule as the projection currently believes it. */
export interface ProjectedRule {
  id: string;
  identityHash: string;
  fullHash: string;
  audienceId: number | null;
  attributeIds: number[];
  version: number;
  state: 'ACTIVE' | 'SUPERSEDED';
  title?: string;
  /** Every document that has asserted this rule — restatements land here. */
  sourceDocs: string[];
  effectiveFrom: string;
}

/** A version written but NOT applied. An amendment never auto-applies. */
export interface StagedVersion {
  ruleId: string;
  version: number;
  fromFullHash: string;
  toFullHash: string;
  assertedBy: string;
  effectiveFrom: string;
  reason: string;
}

export interface ReviewItem {
  key: string;
  docId: string;
  reason: string;
  candidates: string[];
}

export interface Decision {
  verdict: Verdict;
  lane: Lane;
  targetId?: string;
  /** Lane 3 output: possibilities, never decisions. */
  candidates?: string[];
  reason?: string;
}

export interface Graph {
  rules: Map<string, ProjectedRule>;
  staged: StagedVersion[];
  review: ReviewItem[];
}

export function emptyGraph(): Graph {
  return { rules: new Map(), staged: [], review: [] };
}

const overlap = (a: number[], b: number[]) => a.filter((x) => b.includes(x)).length;

/**
 * The three lanes.
 *
 *   LANE 1  FINGERPRINT  exact identity lookup. Deterministic, free, and blind
 *                        to everything except a moved VALUE.
 *   LANE 2  CITATION     the circular says so, in words. The only lane that
 *                        sees repeals and structural amendments.
 *   LANE 3  FUZZY        same audience + overlapping attributes → candidates.
 *
 * **When lanes 1 and 2 disagree, lane 2 wins.** An explicit statement of intent
 * from the regulator outranks a hash collision: the hash is an inference, the
 * citation is a fact.
 */
export function classify(incoming: IncomingRule, graph: Graph): Decision {
  const active = [...graph.rules.values()].filter((r) => r.state === 'ACTIVE');

  // ── LANE 2 first, so it can outrank lane 1 ─────────────────────────────────
  for (const citation of incoming.citations ?? []) {
    if (!citation.targetIdentityHash) continue;
    const targets = active.filter((r) => r.identityHash === citation.targetIdentityHash);
    if (targets.length === 0) continue;
    if (targets.length > 1) {
      return {
        verdict: 'ambiguous',
        lane: 'citation',
        candidates: targets.map((t) => t.id),
        reason: `citation "${citation.raw}" matches ${targets.length} rules`,
      };
    }
    if (citation.kind === 'repeals' || citation.kind === 'supersedes') {
      return { verdict: 'repeal', lane: 'citation', targetId: targets[0].id, reason: citation.raw };
    }
    if (citation.kind === 'amends') {
      return { verdict: 'amendment', lane: 'citation', targetId: targets[0].id, reason: citation.raw };
    }
  }

  // ── LANE 1 — fingerprint ───────────────────────────────────────────────────
  const identityMatches = active.filter((r) => r.identityHash === incoming.identityHash);
  if (identityMatches.length > 1) {
    // Nothing is committed on a partial or multiple match.
    return {
      verdict: 'ambiguous',
      lane: 'fingerprint',
      candidates: identityMatches.map((m) => m.id),
      reason: `${identityMatches.length} live rules share this identity`,
    };
  }
  if (identityMatches.length === 1) {
    const target = identityMatches[0];
    return target.fullHash === incoming.fullHash
      ? { verdict: 'restatement', lane: 'fingerprint', targetId: target.id }
      : { verdict: 'amendment', lane: 'fingerprint', targetId: target.id };
  }

  // ── LANE 3 — fuzzy. Candidates only; a new rule still files as new. ────────
  // Over-flagging here would flood the review queue with every rule that shares
  // an audience, so this never changes the verdict.
  const candidates = active
    .filter(
      (r) =>
        r.audienceId === incoming.audienceId &&
        incoming.attributeIds.length > 0 &&
        overlap(r.attributeIds, incoming.attributeIds) > 0,
    )
    .map((r) => r.id);

  return {
    verdict: 'new',
    lane: candidates.length ? 'fuzzy' : 'fingerprint',
    candidates: candidates.length ? candidates : undefined,
  };
}

/**
 * Apply one decision to the projection.
 *
 * ⚠️ An AMENDMENT is staged, never auto-applied. The reason is not caution: the
 * approval step IS the product. An amendment is the only verdict that can flip a
 * firm from compliant to breaching, and auto-applying it deletes the exact
 * moment the product exists to show — *SEBI issued this → here is precisely who
 * changes → approve*. The blast-radius argument is the same asymmetry that
 * decided Step 14: a new rule adds something and flips nobody; an amendment
 * silently rewrites a live duty.
 */
export function apply(incoming: IncomingRule, decision: Decision, graph: Graph): Graph {
  const target = decision.targetId ? graph.rules.get(decision.targetId) : undefined;

  switch (decision.verdict) {
    case 'restatement':
      // Nothing changes. This circular also says it — provenance only, and it is
      // the most common outcome at corpus scale.
      if (target && !target.sourceDocs.includes(incoming.docId)) {
        target.sourceDocs.push(incoming.docId);
      }
      return graph;

    case 'amendment':
      if (target) {
        graph.staged.push({
          ruleId: target.id,
          version: target.version + 1,
          fromFullHash: target.fullHash,
          toFullHash: incoming.fullHash,
          assertedBy: incoming.docId,
          effectiveFrom: incoming.effectiveFrom,
          reason: decision.reason ?? `${decision.lane} match`,
        });
        // The old version stays ACTIVE until a human approves.
      }
      return graph;

    case 'repeal':
      if (target) target.state = 'SUPERSEDED';
      return graph;

    case 'ambiguous':
      graph.review.push({
        key: incoming.key,
        docId: incoming.docId,
        reason: decision.reason ?? 'ambiguous',
        candidates: decision.candidates ?? [],
      });
      return graph;

    case 'new':
    default:
      graph.rules.set(ruleId(incoming), {
        id: ruleId(incoming),
        identityHash: incoming.identityHash,
        fullHash: incoming.fullHash,
        audienceId: incoming.audienceId,
        attributeIds: incoming.attributeIds,
        version: 1,
        state: 'ACTIVE',
        title: incoming.title,
        sourceDocs: [incoming.docId],
        effectiveFrom: incoming.effectiveFrom,
      });
      return graph;
  }
}

/** A rule's identity in the projection. Stable across replays by construction. */
export function ruleId(incoming: IncomingRule): string {
  return `${incoming.docId}#${incoming.key}`;
}

export interface Assertion extends IncomingRule {
  /** Append order. Only ever a tie-breaker — effectiveFrom is the sort key. */
  seq: number;
}

/**
 * Replay the log into a graph.
 *
 * Sorted by effective date, then by append order for ties. This is what makes a
 * late retroactive circular cheap: append the event and replay from its date,
 * rather than rewriting history in place.
 */
export function project(assertions: Assertion[]): Graph {
  const graph = emptyGraph();
  const ordered = [...assertions].sort(
    (a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.seq - b.seq,
  );
  for (const assertion of ordered) {
    apply(assertion, classify(assertion, graph), graph);
  }
  return graph;
}

/** Convenience for reporting: the decisions a replay would make, in order. */
export function explain(assertions: Assertion[]): { assertion: Assertion; decision: Decision }[] {
  const graph = emptyGraph();
  const out: { assertion: Assertion; decision: Decision }[] = [];
  const ordered = [...assertions].sort(
    (a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.seq - b.seq,
  );
  for (const assertion of ordered) {
    const decision = classify(assertion, graph);
    out.push({ assertion, decision });
    apply(assertion, decision, graph);
  }
  return out;
}
