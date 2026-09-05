/**
 * Step 10b — Pattern A, chapter scoping. The PURE half.
 *
 * Pattern C (D1) gives every clause in a document an audience FLOOR. Pattern A
 * narrows it where the document scopes by chapter:
 *
 *     18.     Enhanced obligations and responsibilities on Qualified Stock Brokers
 *       18.5    Enhanced obligations and responsibilities for QSBs:
 *         18.5.1   ...rule...
 *
 * One heading scopes ~200 clauses by inheritance, and that is what makes the
 * step cheap: resolving the heading resolves everything beneath it for free.
 *
 * This file decides WHICH headings to send, in WHAT ORDER, and WHERE the answers
 * land on the tree. The classification itself is one AI call per heading
 * (audience.py), and the composition of parent + added condition is done in
 * Python so that normalisation, hashing and the harness can never disagree.
 *
 * ⚠️ Order is the load-bearing part. A child heading is composed against its
 * PARENT's resolved audience, not against the document floor, so the tree has to
 * be walked by DEPTH — every heading at depth n is classified before any at
 * depth n+1. Sending them all at once would ask the model about "18.5 ... for
 * QSBs" while still believing its parent is "all stock brokers".
 */

export interface HeadingClause {
  idx: number;
  parentIdx: number | null;
  depth: number;
  heading: string | null;
  clauseNo: string | null;
  text: string | null;
}

export interface HeadingCandidate {
  idx: number;
  heading: string;
  ancestry: string[];
  opening: string;
  /** The idx whose audience is in force here, or null for the document floor. */
  parentAudienceIdx: number | null;
}

/** How much prose under a heading the classifier is shown. */
export const OPENING_CHARS = 600;

/**
 * The first prose under a heading — what the section says it addresses.
 *
 * Deliberately not the whole subtree. A chapter's later clauses describe the
 * duties it imposes, not who owes them, and feeding them in makes every heading
 * look like it is about whatever the first rule happens to mention.
 */
export function openingFor(
  clause: HeadingClause,
  childrenOf: Map<number | null, HeadingClause[]>,
): string {
  let text = (clause.text ?? '').replace(/\s+/g, ' ').trim();
  for (const kid of (childrenOf.get(clause.idx) ?? []).slice(0, 3)) {
    if (text.length >= OPENING_CHARS) break;
    text = `${text} ${(kid.text ?? '').replace(/\s+/g, ' ').trim()}`.trim();
  }
  return text.slice(0, OPENING_CHARS);
}

/**
 * Every heading worth classifying, grouped into levels that must be resolved in
 * order. Level 0 has the document floor as its parent; level n+1 has whatever
 * level n resolved.
 *
 * A repeated heading is classified once. Running headers and table-of-contents
 * echoes carry the same words as the chapter they name, and classifying each
 * occurrence would mint the same audience several times over — rung 3 would
 * collapse them, but only after paying for every call.
 */
export function headingLevels(clauses: HeadingClause[]): HeadingCandidate[][] {
  const byIdx = new Map(clauses.map((c) => [c.idx, c]));
  const childrenOf = new Map<number | null, HeadingClause[]>();
  for (const c of clauses) {
    const list = childrenOf.get(c.parentIdx) ?? [];
    list.push(c);
    childrenOf.set(c.parentIdx, list);
  }

  const ancestorsOf = (c: HeadingClause): HeadingClause[] => {
    const out: HeadingClause[] = [];
    let node: HeadingClause | undefined = c;
    const guard = new Set<number>();
    while (node && node.parentIdx !== null && !guard.has(node.parentIdx)) {
      guard.add(node.parentIdx);
      node = byIdx.get(node.parentIdx);
      if (!node) break;
      out.push(node);
    }
    return out.reverse();
  };

  const seen = new Set<string>();
  const byDepth = new Map<number, HeadingCandidate[]>();
  for (const c of [...clauses].sort((a, b) => a.idx - b.idx)) {
    const heading = (c.heading ?? '').replace(/\s+/g, ' ').trim();
    if (!heading) continue;
    const key = heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ancestry = ancestorsOf(c);
    const candidate: HeadingCandidate = {
      idx: c.idx,
      heading,
      ancestry: ancestry.map((a) => (a.heading ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      opening: openingFor(c, childrenOf),
      // Filled in during the walk — which ancestor actually resolved is not
      // known until that ancestor's level has been classified.
      parentAudienceIdx: null,
    };
    const list = byDepth.get(c.depth) ?? [];
    list.push(candidate);
    byDepth.set(c.depth, list);
  }

  return [...byDepth.keys()]
    .sort((a, b) => a - b)
    .map((d) => byDepth.get(d) as HeadingCandidate[]);
}

/**
 * The nearest ancestor with a resolved audience, or null for the document floor.
 * Used to fill `parentAudienceIdx` once the levels above have been classified.
 */
export function nearestResolved(
  idx: number,
  clauses: HeadingClause[],
  resolvedAt: Map<number, unknown>,
): number | null {
  const byIdx = new Map(clauses.map((c) => [c.idx, c]));
  let node = byIdx.get(idx);
  const guard = new Set<number>();
  while (node && node.parentIdx !== null && !guard.has(node.parentIdx)) {
    guard.add(node.parentIdx);
    node = byIdx.get(node.parentIdx);
    if (!node) break;
    if (resolvedAt.has(node.idx)) return node.idx;
  }
  return null;
}

/**
 * Which audience each clause ends up under — the inheritance in 10f.
 *
 * A clause takes the audience of its NEAREST resolved ancestor (or its own, if
 * it carries an audience heading). Everything else keeps the document floor,
 * which is why the floor exists: no clause is ever left unaddressed.
 */
export function stampTree(
  clauses: HeadingClause[],
  audienceAt: Map<number, number>,
): Map<number, number> {
  const byIdx = new Map(clauses.map((c) => [c.idx, c]));
  const out = new Map<number, number>();
  for (const c of clauses) {
    let node: HeadingClause | undefined = c;
    const guard = new Set<number>();
    while (node) {
      const found = audienceAt.get(node.idx);
      if (found !== undefined) {
        out.set(c.idx, found);
        break;
      }
      if (node.parentIdx === null || guard.has(node.parentIdx)) break;
      guard.add(node.parentIdx);
      node = byIdx.get(node.parentIdx);
    }
  }
  return out;
}
