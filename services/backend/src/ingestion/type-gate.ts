/**
 * Step 13, STEP 4 — the type gate.
 *
 * The cheapest guard in the funnel, and the one that was missing: candidates
 * arrived ranked purely by meaning distance, so nothing stopped a date merging
 * with a count.
 *
 *     "date of last audit"    date    \  wording ~0.1 apart
 *     "number of audits"      number  /  MERGED under a single id
 *
 * Type mismatch is the most common false merge in every data-catalogue system,
 * it costs nothing to prevent, and it is near-impossible to unpick afterwards:
 * once two facts share an id, EVERY rule using either of them is wrong, and the
 * broker's intake form asks one question where it should ask two.
 *
 * ⚠️ It runs BEFORE the distance decision, not after. A gate applied to the
 * winner only would let a mistyped candidate at 0.02 crowd out a correctly typed
 * one at 0.06 and then be discarded, leaving a create where a reuse was right.
 * Filtering the candidate LIST is what makes the second-best candidate reachable.
 */

export type DataType = 'date' | 'number' | 'boolean' | 'string' | 'document';

export interface TypedCandidate {
  id: number;
  dataType: string;
  unit?: string | null;
}

/**
 * Units that measure the same kind of thing.
 *
 * A rule comparing `days` to `months` is fine — Step 11d converts for comparison
 * rather than rejecting. A rule comparing `days` to `rupees` is not, and neither
 * are two data-points that claim to be the same fact in those units.
 */
const DIMENSION: Record<string, string> = {
  hours: 'time', days: 'time', months: 'time', years: 'time',
  rupees: 'money', inr: 'money', crore: 'money', lakh: 'money',
  percent: 'ratio', ratio: 'ratio',
  count: 'count',
};

export function unitsCompatible(a?: string | null, b?: string | null): boolean {
  const left = (a ?? '').trim().toLowerCase();
  const right = (b ?? '').trim().toLowerCase();
  // An unstated unit is not a claim about anything, so it never blocks a merge.
  // Being strict here would split `net_worth` from `net_worth (rupees)` and
  // create exactly the duplicate the register exists to prevent.
  if (!left || !right) return true;
  if (left === right) return true;
  const da = DIMENSION[left];
  const db = DIMENSION[right];
  // Two units we do not recognise are compared literally: if we cannot say they
  // measure the same thing, we do not assume it.
  if (!da || !db) return false;
  return da === db;
}

/**
 * Whether an incoming token may merge with an existing data-point.
 *
 * `string` is deliberately permissive in ONE direction: the drafter falls back
 * to `string` when it cannot tell, and treating "don't know" as a hard mismatch
 * would fragment the register on the drafter's uncertainty rather than on any
 * real difference. A stated type never merges with a different stated type.
 */
export function typesCompatible(incoming?: string | null, existing?: string | null): boolean {
  const a = (incoming ?? '').trim().toLowerCase();
  const b = (existing ?? '').trim().toLowerCase();
  if (!a || !b) return true;
  if (a === b) return true;
  if (a === 'string' || b === 'string') return true;
  return false;
}

export interface GateResult<T extends TypedCandidate> {
  kept: T[];
  /** Discarded, with why — this is what the ingest console shows. */
  rejected: { id: number; reason: 'type' | 'unit'; was: string; wanted: string }[];
}

/**
 * Discard any candidate whose type or unit differs. A date can NEVER merge with
 * a count, however similar the wording.
 */
export function typeGate<T extends TypedCandidate>(
  candidates: T[],
  hint: { data_type?: string | null; unit?: string | null } | undefined,
): GateResult<T> {
  const wantType = hint?.data_type ?? null;
  const wantUnit = hint?.unit ?? null;
  const kept: T[] = [];
  const rejected: GateResult<T>['rejected'] = [];

  for (const c of candidates) {
    if (!typesCompatible(wantType, c.dataType)) {
      rejected.push({
        id: c.id,
        reason: 'type',
        was: c.dataType,
        wanted: wantType ?? '(unstated)',
      });
      continue;
    }
    if (!unitsCompatible(wantUnit, c.unit)) {
      rejected.push({
        id: c.id,
        reason: 'unit',
        was: c.unit ?? '(none)',
        wanted: wantUnit ?? '(none)',
      });
      continue;
    }
    kept.push(c);
  }
  return { kept, rejected };
}
