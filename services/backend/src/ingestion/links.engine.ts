/**
 * Step 16 — link resolution. The PURE half.
 *
 * A citation names a CLAUSE. An edge joins RULES. Those are not the same hop, and
 * the gap between them is where this file lives:
 *
 *     citation "para 9.5.3.1"  →  clause 9.5.3.1  →  the three rules it produced
 *                                 ^^^^^^^^^^^^^^     ^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                                 16a hop one        16a hop two, genuinely ambiguous
 *
 * Both hops can fail, and they fail differently:
 *
 *   hop one   the number is ambiguous — "1" is 152 distinct clauses in CSCRF, so
 *             `clause_no` is not a key (Decision 66). Scope by the citing clause's
 *             own ancestry first, then the document, then give up.
 *   hop two   the clause produced several rules and the citation cannot say which.
 *
 * Hop two is resolved by the SAME asymmetry that decided Steps 14 and 15:
 *
 *   depends_on           FAN OUT to every rule of the cited clause. "unable to
 *                        comply with 9.5.3.1" plausibly means any of its duties
 *                        failing, and over-linking is recoverable — evaluation
 *                        walks the edge and finds nothing wrong.
 *   amends / supersedes  MUST BE PRECISE. Amending three rules when SEBI meant one
 *                        corrupts the graph silently. Ambiguous → REVIEW, never
 *                        auto-filed.
 *
 * Everything here is a pure function of its arguments. The database half is
 * links.service.ts.
 */

export type LinkEdgeType = 'depends_on' | 'shared_evidence' | 'split_of' | 'amends' | 'supersedes';
export type LinkEdgeState = 'ACTIVE' | 'REVIEW';

/** One reference string, as the AI service extracted it (citations.py). */
export interface ExtractedCitation {
  raw: string;
  cue: string;
  number: string;
  kind: 'definitional' | 'exemption' | 'amends' | 'supersedes' | 'trigger' | 'reference';
  targetType: 'internal' | 'statute' | 'annexure';
  targetContainer?: string | null;
  targetDoc?: string | null;
  rangeTo?: string | null;
  charStart?: number;
  charEnd?: number;
  context?: string;
}

/** A clause as the resolver needs to see it: a number, a parent, and an id. */
export interface ClauseNode {
  id: number;
  clauseNo: string | null;
  parentId: number | null;
  /** Only `clause` nodes are citable — a table-of-contents row carrying the same
   *  number is not a target, and neither is provable junk. */
  citable: boolean;
  /** The nearest annexure/chapter heading above it, when there is one. Used only
   *  when a citation states its container explicitly ("para 3 of Annexure B"). */
  container?: string | null;
}

export interface ResolvedTarget {
  clauseIds: number[];
  /** how the target was found — this is what an auditor is shown */
  how: 'unique' | 'scoped' | 'container' | 'ambiguous' | 'absent' | 'external';
}

/** Everything a rule contributes to linking. */
export interface LinkRule {
  id: number;
  clauseId: number | null;
  attributeIds: number[];
  state: string;
}

export interface ProposedEdge {
  fromId: number;
  toId: number;
  type: LinkEdgeType;
  state: LinkEdgeState;
  confidence: number;
  sourceCitation: Record<string, unknown>;
}

// ── 16a hop one: citation → clause ──────────────────────────────────────────

/**
 * Which clause a citation points at.
 *
 * Order matters and is the design's: the citing clause's own subtree first
 * (nearest ancestor wins), then document-wide, then nothing. A citation inside
 * Annexure B saying "para 3" almost always means Annexure B's para 3, and
 * searching the document first would silently prefer the body's.
 */
export function resolveTarget(
  citation: ExtractedCitation,
  citingClauseId: number | null,
  clauses: ClauseNode[],
): ResolvedTarget {
  if (citation.targetType !== 'internal') return { clauseIds: [], how: 'external' };

  const byId = new Map(clauses.map((c) => [c.id, c]));
  const candidates = clauses.filter((c) => c.citable && c.clauseNo === citation.number);
  if (candidates.length === 0) return { clauseIds: [], how: 'absent' };

  // An explicitly stated container beats everything: the text said where to look.
  if (citation.targetContainer) {
    const want = citation.targetContainer.toLowerCase();
    const inContainer = candidates.filter((c) => (c.container ?? '').toLowerCase() === want);
    if (inContainer.length === 1) return { clauseIds: [inContainer[0].id], how: 'container' };
    if (inContainer.length > 1) {
      return { clauseIds: inContainer.map((c) => c.id), how: 'ambiguous' };
    }
  }

  if (candidates.length === 1) return { clauseIds: [candidates[0].id], how: 'unique' };

  // Ambiguous document-wide. Walk up from the citing clause; the first ancestor
  // whose subtree contains exactly one candidate wins. An ancestor containing
  // SEVERAL stops the walk rather than continuing upward — going higher can only
  // add more candidates, never fewer.
  if (citingClauseId !== null) {
    const childrenOf = new Map<number | null, ClauseNode[]>();
    for (const c of clauses) {
      const list = childrenOf.get(c.parentId) ?? [];
      list.push(c);
      childrenOf.set(c.parentId, list);
    }
    const inSubtree = (rootId: number): Set<number> => {
      const seen = new Set<number>();
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop() as number;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const kid of childrenOf.get(id) ?? []) stack.push(kid.id);
      }
      return seen;
    };
    let node = byId.get(citingClauseId) ?? null;
    const guard = new Set<number>();
    while (node && node.parentId !== null && !guard.has(node.parentId)) {
      guard.add(node.parentId);
      const scope = inSubtree(node.parentId);
      const inside = candidates.filter((c) => scope.has(c.id) && c.id !== citingClauseId);
      if (inside.length === 1) return { clauseIds: [inside[0].id], how: 'scoped' };
      if (inside.length > 1) break;
      node = byId.get(node.parentId) ?? null;
    }
  }

  return { clauseIds: candidates.map((c) => c.id), how: 'ambiguous' };
}

// ── 16a hop two: clause → rules ─────────────────────────────────────────────

const EDGE_FOR: Record<string, LinkEdgeType | undefined> = {
  trigger: 'depends_on',
  amends: 'amends',
  supersedes: 'supersedes',
  // definitional was inlined at Step 9, exemption became a modifier at Step 12,
  // and a plain reference asserts nothing. None of them is an edge.
};

/** Whether being imprecise about this edge is recoverable. */
const FANS_OUT: Record<LinkEdgeType, boolean> = {
  depends_on: true,
  shared_evidence: true,
  split_of: true,
  amends: false,
  supersedes: false,
};

export interface EdgeProposal {
  edges: ProposedEdge[];
  /** Citations that produced no edge, with the reason — the parking queue. */
  parked: {
    citation: ExtractedCitation;
    fromRuleId: number | null;
    fromClauseId: number | null;
    reason: string;
  }[];
}

/**
 * Turn one document's citations into edges.
 *
 * `rules` is every rule in the graph, because a citation routinely points at a
 * clause of an EARLIER circular. Only rules whose clause is present in `clauses`
 * can be targeted; the rest park for the sweep.
 */
export function proposeEdges(
  citations: { clauseId: number; citation: ExtractedCitation }[],
  clauses: ClauseNode[],
  rules: LinkRule[],
): EdgeProposal {
  const rulesByClause = new Map<number, LinkRule[]>();
  for (const r of rules) {
    if (r.clauseId === null) continue;
    const list = rulesByClause.get(r.clauseId) ?? [];
    list.push(r);
    rulesByClause.set(r.clauseId, list);
  }

  const edges: ProposedEdge[] = [];
  const parked: EdgeProposal['parked'] = [];

  for (const { clauseId, citation } of citations) {
    const type = EDGE_FOR[citation.kind];
    const sources = rulesByClause.get(clauseId) ?? [];
    if (!type) continue; // consumed earlier, or inert — not this step's business

    const target = resolveTarget(citation, clauseId, clauses);
    if (target.clauseIds.length === 0) {
      parked.push({
        citation,
        fromRuleId: sources[0]?.id ?? null,
        fromClauseId: clauseId,
        reason: target.how, // 'absent' | 'external'
      });
      continue;
    }
    if (sources.length === 0) {
      // The citing clause produced no rule — nothing to hang the edge on. Parked
      // rather than dropped: a re-ingest with a better drafter may produce one.
      parked.push({ citation, fromRuleId: null, fromClauseId: clauseId, reason: 'no_source_rule' });
      continue;
    }

    // Ambiguous CLAUSE target. Fanning out here would multiply the ambiguity by
    // every rule of every candidate, so a precise edge type refuses outright.
    if (target.how === 'ambiguous' && !FANS_OUT[type]) {
      parked.push({ citation, fromRuleId: sources[0].id, fromClauseId: clauseId, reason: 'ambiguous' });
      continue;
    }

    const targetRules = target.clauseIds.flatMap((cid) => rulesByClause.get(cid) ?? []);
    if (targetRules.length === 0) {
      parked.push({
        citation,
        fromRuleId: sources[0].id,
        fromClauseId: clauseId,
        reason: 'target_has_no_rules',
      });
      continue;
    }
    // A precise edge type that lands on several rules is exactly the case 16a
    // warns about: amending three rules when SEBI meant one.
    if (!FANS_OUT[type] && targetRules.length > 1) {
      parked.push({
        citation,
        fromRuleId: sources[0].id,
        fromClauseId: clauseId,
        reason: 'target_not_precise',
      });
      continue;
    }

    // An edge that was not resolved exactly must not read as an accepted fact (16c).
    //
    // `scoped` counts as not-exact, and that is a measured call, not caution:
    // nearest-ancestor scoping settles only 15 of the 68 document-wide-ambiguous
    // citations in the SEBI corpus, and the first one it produced on real data
    // linked an investment-limit rule to a table row numbered "1". It is the best
    // guess available and it is still a guess.
    //
    // `amends` and `supersedes` are ALWAYS review, however cleanly they resolved:
    // Step 15 owns the filing verdict, and Step 16 has not produced one. An
    // ACTIVE amends edge would assert a change to the graph that the version
    // history does not record.
    const exact = target.how === 'unique' || target.how === 'container';
    const state: LinkEdgeState = exact && FANS_OUT[type] ? 'ACTIVE' : 'REVIEW';
    const confidence = exact ? 0.9 : target.how === 'scoped' ? 0.7 : 0.4;

    for (const from of sources) {
      for (const to of targetRules) {
        if (from.id === to.id) continue; // a rule cannot depend on itself
        edges.push({
          fromId: from.id,
          toId: to.id,
          type,
          state,
          confidence,
          sourceCitation: {
            raw: citation.raw,
            kind: citation.kind,
            number: citation.number,
            resolved_by: target.how,
            from_clause: clauseId,
            char: [citation.charStart ?? 0, citation.charEnd ?? 0],
            context: (citation.context ?? '').slice(0, 240),
          },
        });
      }
    }
  }

  return { edges, parked };
}

// ── shared_evidence — the one link that comes from nowhere in the text ───────

/**
 * Two obligations satisfied by the same uploaded document.
 *
 * This is what makes "upload once, satisfy nine rules" possible, and it is
 * computed from attribute overlap rather than read from a citation — no circular
 * says "this evidence also serves paragraph 12".
 *
 * `minShared` is 1 by default and matters: with 0 every rule would share evidence
 * with every other. Grouping is by the SET of shared attributes, so the group is
 * "everything the firm's audit report satisfies", not a pile of pairs.
 */
export function sharedEvidenceGroups(
  rules: LinkRule[],
  opts: { minShared?: number; minGroup?: number } = {},
): { attributeIds: number[]; ruleIds: number[] }[] {
  const minShared = opts.minShared ?? 1;
  const minGroup = opts.minGroup ?? 2;
  const byKey = new Map<string, { attributeIds: number[]; ruleIds: number[] }>();
  for (const r of rules) {
    if (r.attributeIds.length < minShared) continue;
    const ids = [...new Set(r.attributeIds)].sort((a, b) => a - b);
    const key = ids.join(',');
    const entry = byKey.get(key) ?? { attributeIds: ids, ruleIds: [] };
    entry.ruleIds.push(r.id);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .filter((g) => g.ruleIds.length >= minGroup)
    .map((g) => ({ ...g, ruleIds: g.ruleIds.sort((a, b) => a - b) }));
}

/**
 * `split_of` — structural, not citation-derived. One clause routinely yields
 * several rules, and the graph should say so: it is how "show me everything
 * paragraph 9.5.3 requires" is answered, and how a later amendment to that
 * paragraph finds all of its descendants.
 */
export function splitEdges(rules: LinkRule[]): ProposedEdge[] {
  const byClause = new Map<number, LinkRule[]>();
  for (const r of rules) {
    if (r.clauseId === null) continue;
    const list = byClause.get(r.clauseId) ?? [];
    list.push(r);
    byClause.set(r.clauseId, list);
  }
  const out: ProposedEdge[] = [];
  for (const [clauseId, group] of byClause) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    const [first, ...rest] = sorted;
    for (const sibling of rest) {
      out.push({
        fromId: sibling.id,
        toId: first.id,
        type: 'split_of',
        state: 'ACTIVE',
        confidence: 1,
        sourceCitation: { kind: 'structural', from_clause: clauseId, siblings: sorted.length },
      });
    }
  }
  return out;
}

// ── cycles ──────────────────────────────────────────────────────────────────

/**
 * Would adding from→to close a cycle?
 *
 * **Detected at INSERT, never at evaluation.** Step 24 walks `depends_on` during
 * evaluation, so a cycle there is an infinite loop in the product's hot path —
 * and the firm whose status triggered it is the one who sees the hang. Refusing
 * one edge at ingest is a line in a report; refusing it at evaluation is an
 * outage.
 *
 * Only `depends_on` is walked. `split_of` points at a sibling and `shared_evidence`
 * is symmetric by nature; neither is traversed during evaluation.
 */
export function wouldCycle(
  edges: { fromId: number; toId: number; type: string }[],
  fromId: number,
  toId: number,
): boolean {
  if (fromId === toId) return true;
  const next = new Map<number, number[]>();
  for (const e of edges) {
    if (e.type !== 'depends_on') continue;
    const list = next.get(e.fromId) ?? [];
    list.push(e.toId);
    next.set(e.fromId, list);
  }
  // Does `to` already reach `from`? If so, from→to closes the loop.
  const seen = new Set<number>([toId]);
  const stack = [toId];
  while (stack.length) {
    const id = stack.pop() as number;
    if (id === fromId) return true;
    for (const nxt of next.get(id) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return false;
}

/**
 * Accept edges one at a time, refusing any that would close a cycle.
 *
 * One at a time is the point: accepting a batch and then checking would leave
 * the caller holding a cyclic graph and no way to say which edge caused it.
 */
export function admitEdges(
  existing: { fromId: number; toId: number; type: string }[],
  proposed: ProposedEdge[],
): { admitted: ProposedEdge[]; refused: { edge: ProposedEdge; reason: string }[] } {
  const graph = [...existing];
  const admitted: ProposedEdge[] = [];
  const refused: { edge: ProposedEdge; reason: string }[] = [];
  const seen = new Set(graph.map((e) => `${e.fromId}->${e.toId}:${e.type}`));

  for (const edge of proposed) {
    const key = `${edge.fromId}->${edge.toId}:${edge.type}`;
    if (seen.has(key)) continue; // idempotent: re-ingest must not duplicate edges
    if (edge.type === 'depends_on' && wouldCycle(graph, edge.fromId, edge.toId)) {
      refused.push({ edge, reason: 'cycle' });
      continue;
    }
    graph.push(edge);
    seen.add(key);
    admitted.push(edge);
  }
  return { admitted, refused };
}

// ── 16b: the retry sweep ────────────────────────────────────────────────────

export interface ParkedCitation {
  id: number;
  fromClauseId: number | null;
  fromObligationId: number | null;
  rawText: string;
  targetDoc: string | null;
  targetContainer: string | null;
  targetClauseNo: string | null;
  edgeType: string | null;
  attempts: number;
}

/**
 * Which parked citations a newly arrived document might satisfy.
 *
 * Keyed on **container + number**, never number alone. That is not caution, it is
 * Decision 66 measured: clause "1" exists 152 times in CSCRF, so a queue keyed on
 * the number would wake up for every one of them.
 *
 * `maxAttempts` stops the queue growing forever: a citation to a document that
 * will never be ingested must eventually be abandoned rather than swept on every
 * future ingest.
 */
export function sweepCandidates(
  parked: ParkedCitation[],
  arrived: { docId: string; clauses: ClauseNode[] },
  opts: { maxAttempts?: number } = {},
): { resolve: { parked: ParkedCitation; clauseId: number }[]; abandon: ParkedCitation[] } {
  const maxAttempts = opts.maxAttempts ?? 5;
  const byKey = new Map<string, ClauseNode[]>();
  for (const c of arrived.clauses) {
    if (!c.citable || !c.clauseNo) continue;
    const key = `${(c.container ?? '').toLowerCase()}|${c.clauseNo}`;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
    // also indexed without a container, for the common unqualified citation
    const bare = `|${c.clauseNo}`;
    if (key !== bare) {
      const b = byKey.get(bare) ?? [];
      b.push(c);
      byKey.set(bare, b);
    }
  }

  const resolve: { parked: ParkedCitation; clauseId: number }[] = [];
  const abandon: ParkedCitation[] = [];
  for (const p of parked) {
    if (p.targetDoc && p.targetDoc !== arrived.docId) continue;
    if (!p.targetClauseNo) {
      if (p.attempts + 1 >= maxAttempts) abandon.push(p);
      continue;
    }
    const hits = byKey.get(`${(p.targetContainer ?? '').toLowerCase()}|${p.targetClauseNo}`) ?? [];
    if (hits.length === 1) {
      resolve.push({ parked: p, clauseId: hits[0].id });
    } else if (p.attempts + 1 >= maxAttempts) {
      abandon.push(p);
    }
  }
  return { resolve, abandon };
}
