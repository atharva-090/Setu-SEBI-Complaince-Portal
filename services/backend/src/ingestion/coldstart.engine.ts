/**
 * Step 13 — cold start vs steady state. The PURE half.
 *
 * The funnel resolves one token at a time against whatever is already in the
 * register. That is right in STEADY STATE — one circular arriving against a
 * settled register — and wrong on a BULK LOAD, because it means **whichever
 * document is processed first names everything forever**:
 *
 *     a 2019 circular says  aud_dt              -> becomes canonical
 *     400 later circulars say  last_audit_date  -> all filed as aliases of it
 *
 * Nothing is factually wrong afterwards; every mention still points at one id.
 * But the register is now named by an accident of processing order, and the
 * name is what a human reads on the intake form, in the audit pack and in every
 * review queue. Decision 60.
 *
 * This is a **build gap, not a test gap** (decision 61): no amount of testing
 * the funnel finds it, because the funnel is behaving exactly as designed.
 *
 *     BULK LOAD                          STEADY STATE
 *     collect ALL mentions first         one circular against a settled register
 *     cluster them together              run the funnel, token at a time
 *     name by frequency x recency        most resolve with no judge call
 *       x clarity
 *     every other spelling -> alias
 *
 * Same funnel, different entry point: bulk load decides ONCE with full corpus
 * knowledge; steady state decides incrementally against what is settled.
 */

import { typesCompatible, unitsCompatible } from './type-gate';

export interface Mention {
  /** The token exactly as the drafter spelled it. */
  token: string;
  docId: string;
  /** ISO date the document takes effect — recency, not ingestion order. */
  effectiveFrom: string;
  dataType: string;
  unit?: string | null;
  meaning?: string;
  topic?: string;
  /** The composite embedding. Absent under mock embeddings, and the clusterer
   *  says so rather than pretending the vector band fired. */
  embedding?: number[] | null;
}

export interface Cluster {
  /** The name that wins. */
  canonicalName: string;
  /** Every other spelling seen, as provenance. */
  aliases: string[];
  dataType: string;
  unit: string | null;
  mentions: number;
  docs: string[];
  /** Why this name won — shown in the approval queue, never hidden. */
  rationale: string;
  /** Clusters this close to another are worth a human or a batched judge. */
  borderline: boolean;
}

/** Cosine distance between two unit-length vectors. */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Distance below which two mentions are the same data-point. */
export const CLUSTER_MAX = 0.15;
/** Between this and CLUSTER_MAX, a cluster is worth a second look. */
export const BORDERLINE_MAX = 0.30;

// ── naming ──────────────────────────────────────────────────────────────────

/**
 * How readable a name is, as a number.
 *
 * `last_audit_date` beats `aud_dt` on two counts a machine can actually see:
 * it has more whole words, and fewer of them are truncations. Nothing here
 * claims to judge English — it separates a spelled-out name from an
 * abbreviation, which is the distinction that matters.
 */
export function clarity(name: string): number {
  const parts = name.split(/[_\s]+/).filter(Boolean);
  if (parts.length === 0) return 0;
  const words = parts.length;
  const abbreviated = parts.filter(
    (p) => p.length <= 3 || !/[aeiou]/i.test(p),
  ).length;
  const avgLength = parts.reduce((n, p) => n + p.length, 0) / words;
  // Words help, abbreviations hurt, and very long names are not better than
  // clear ones — the average word length is capped rather than rewarded.
  return words * 2 - abbreviated * 3 + Math.min(avgLength, 8) / 4;
}

/** Recency as a 0..1 weight: this year is 1, ten years ago is ~0. */
export function recency(effectiveFrom: string, now = new Date()): number {
  const then = new Date(effectiveFrom);
  if (Number.isNaN(then.getTime())) return 0.5;
  const years = (now.getTime() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.min(1, 1 - years / 10));
}

/**
 * The canonical name for a cluster: frequency x recency x clarity.
 *
 * Frequency dominates, and deliberately: a spelling used 400 times is what
 * people already recognise, and the register exists to be read. Recency breaks
 * ties toward current drafting practice, and clarity breaks the rest.
 */
export function chooseName(
  mentions: Mention[],
  now = new Date(),
): { name: string; rationale: string } {
  const byToken = new Map<string, { count: number; recency: number }>();
  for (const m of mentions) {
    const entry = byToken.get(m.token) ?? { count: 0, recency: 0 };
    entry.count += 1;
    entry.recency = Math.max(entry.recency, recency(m.effectiveFrom, now));
    byToken.set(m.token, entry);
  }

  let best = '';
  let bestScore = -Infinity;
  let bestParts = { count: 0, recency: 0, clarity: 0 };
  for (const [token, { count, recency: rec }] of byToken) {
    const cl = clarity(token);
    // Frequency on a log scale: 400 mentions should beat 1 decisively, but 400
    // should not beat 380 on frequency alone when one is far clearer.
    const score = Math.log2(count + 1) * 3 + rec * 1.5 + cl;
    if (score > bestScore) {
      bestScore = score;
      best = token;
      bestParts = { count, recency: rec, clarity: cl };
    }
  }

  const runnerUp = [...byToken.entries()]
    .filter(([t]) => t !== best)
    .sort((a, b) => b[1].count - a[1].count)[0];
  const rationale = runnerUp
    ? `"${best}" used ${bestParts.count}x (clarity ${bestParts.clarity.toFixed(1)}) ` +
      `beats "${runnerUp[0]}" used ${runnerUp[1].count}x ` +
      `(clarity ${clarity(runnerUp[0]).toFixed(1)})`
    : `"${best}" is the only spelling seen (${bestParts.count}x)`;

  return { name: best, rationale };
}

// ── clustering ──────────────────────────────────────────────────────────────

/**
 * Cluster every mention across the whole corpus at once.
 *
 * Not pairwise comparison: mentions are assigned to the first cluster whose
 * SEED they are close enough to, which is O(n x clusters) rather than O(n²).
 * With ~180,000 mentions collapsing to ~4,000 clusters that difference is the
 * whole feasibility of the step.
 *
 * ⚠️ The type gate applies here too. Clustering by meaning alone would fuse a
 * date with a count exactly as the funnel would — and at bulk-load scale it
 * would do it thousands of times before anyone looked.
 */
export function cluster(
  mentions: Mention[],
  opts: { max?: number; now?: Date } = {},
): { clusters: Cluster[]; stats: { mentions: number; clusters: number; withVectors: number; borderline: number } } {
  const max = opts.max ?? CLUSTER_MAX;
  const now = opts.now ?? new Date();

  const seeds: { mention: Mention; members: Mention[]; nearestOther: number }[] = [];
  let withVectors = 0;

  for (const m of mentions) {
    if (m.embedding && m.embedding.length) withVectors += 1;
    let placed = false;
    for (const seed of seeds) {
      // The gate first, always. Two facts of different types are never the same
      // data-point, however close their wording.
      if (!typesCompatible(m.dataType, seed.mention.dataType)) continue;
      if (!unitsCompatible(m.unit, seed.mention.unit)) continue;

      let distance: number;
      if (m.embedding?.length && seed.mention.embedding?.length) {
        distance = cosineDistance(m.embedding, seed.mention.embedding);
      } else {
        // No usable vectors (mock embeddings are random). Fall back to the exact
        // token, which is honest: it dedupes what is provably identical and
        // clusters nothing it cannot see.
        distance = m.token === seed.mention.token ? 0 : 1;
      }
      if (distance <= max) {
        seed.members.push(m);
        placed = true;
        break;
      }
      seed.nearestOther = Math.min(seed.nearestOther, distance);
    }
    if (!placed) seeds.push({ mention: m, members: [m], nearestOther: 1 });
  }

  const clusters: Cluster[] = seeds.map((seed) => {
    const { name, rationale } = chooseName(seed.members, now);
    const spellings = [...new Set(seed.members.map((m) => m.token))];
    return {
      canonicalName: name,
      aliases: spellings.filter((t) => t !== name),
      dataType: seed.mention.dataType,
      unit: seed.mention.unit ?? null,
      mentions: seed.members.length,
      docs: [...new Set(seed.members.map((m) => m.docId))],
      rationale,
      borderline: seed.nearestOther > max && seed.nearestOther <= BORDERLINE_MAX,
    };
  });

  return {
    clusters: clusters.sort((a, b) => b.mentions - a.mentions),
    stats: {
      mentions: mentions.length,
      clusters: clusters.length,
      withVectors,
      borderline: clusters.filter((c) => c.borderline).length,
    },
  };
}
