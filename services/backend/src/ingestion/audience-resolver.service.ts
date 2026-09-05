import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Audience } from '../database/entities/audience.entity';
import { AudienceEdge } from '../database/entities/audience-edge.entity';
import { AiAudience, AiClientService } from './ai-client.service';

/**
 * Step 10 — the audience ladder.
 *
 * Everywhere else in this pipeline, matching is done by meaning similarity. That
 * is right for data-points, because "date of last audit" is a human notion with
 * fuzzy edges. **An audience is different: it is a set of firms, and sets can be
 * compared exactly.** Using a similarity score here would throw away certainty
 * available for free.
 *
 * So the AI translates prose into a TEST, and from that point the computer
 * decides:
 *
 *   RUNG 3  exact match on the normalised test        → reuse
 *   RUNG 4  logical implication                       → reuse, or nest
 *   RUNG 5  meaning similarity                          → shortlist ≤3
 *   RUNG 6  AI judge on that shortlist                  → reuse, or fall through
 *   RUNG 7  new audience                              → create (needs approval)
 */

export type Rung = 'exact' | 'implication' | 'similarity' | 'created';

export interface AudienceResolution {
  audience: AudienceRecord;
  rung: Rung;
  /** Audiences this one was nested under (rung 4, A implies B). */
  broaderThan: number[];
  /** Audiences nested under this one (rung 4, B implies A). */
  narrowerThan: number[];
  confidence: number;
  needsApproval: boolean;
}

/** The subset of the audiences table the ladder needs. Kept narrow so the test
 *  harness can stand in for the repository without a database. */
export interface AudienceRecord {
  id: number;
  label: string;
  predicate: string;
  predicateHash: string;
  properties: string[];
  aliases: string[];
  pattern: string | null;
  /** Step 10e — PROPOSED until a human approves it. */
  state?: 'PROPOSED' | 'APPROVED';
  confidence?: number | null;
}

export interface AudienceStore {
  findByHash(hash: string): Promise<AudienceRecord | null>;
  all(): Promise<AudienceRecord[]>;
  create(
    row: Omit<AudienceRecord, 'id'> & { createdFrom?: string; confidence?: number },
  ): Promise<AudienceRecord>;
  addAlias(id: number, alias: string): Promise<void>;
  link(narrowerId: number, broaderId: number, derivation: string): Promise<void>;
  /** Rung 5. Optional so a test store can omit it and exercise rungs 3/4/7
   *  alone — which is exactly how the ladder behaved before these rungs. */
  nearest?(predicate: string, maxDistance: number, limit: number): Promise<AudienceRecord[]>;
}

const NUMERIC_OPS = new Set(['>', '>=', '<', '<=']);

/**
 * Rung 4. For the common shape — conditions joined by AND — A implies B when
 * every condition in B is satisfied by some condition in A. This is only
 * possible because audiences are stored as tests rather than names.
 *
 * The condition strings arrive already normalised from the AI service, which is
 * the single place normalisation lives; re-implementing it here is exactly how
 * the two would drift.
 */
export function conditionImplies(a: string, b: string): boolean {
  if (a === b) return true;
  const [an, ao, ...av] = a.split(' ');
  const [bn, bo, ...bv] = b.split(' ');
  if (an !== bn) return false;
  const aValue = av.join(' ');
  const bValue = bv.join(' ');

  const members = (v: string) =>
    v.replace(/^\[|\]$/g, '').split(',').map((m) => m.trim()).filter(Boolean);

  // A single value implies the set containing it; a set implies a superset.
  if (bo === 'in' && ao === '==') return members(bValue).includes(aValue);
  if (bo === 'in' && ao === 'in') {
    const bSet = new Set(members(bValue));
    return members(aValue).every((m) => bSet.has(m));
  }

  // Interval containment: active_clients > 50000 implies active_clients > 10000.
  if (NUMERIC_OPS.has(ao) && NUMERIC_OPS.has(bo)) {
    const x = Number(aValue);
    const y = Number(bValue);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    const up = (op: string) => op === '>' || op === '>=';
    const down = (op: string) => op === '<' || op === '<=';
    if (up(ao) && up(bo)) return x > y || (x === y && (ao === bo || ao === '>'));
    if (down(ao) && down(bo)) return x < y || (x === y && (ao === bo || ao === '<'));
  }
  return false;
}

/** Every firm matching A also matches B. An empty test selects everyone. */
export function implies(a: string[], b: string[]): boolean {
  if (b.length === 0) return true;
  if (a.length === 0) return false;
  return b.every((cond) => a.some((other) => conditionImplies(other, cond)));
}

export type Relation = 'identical' | 'narrower' | 'broader' | 'unrelated';

export function compare(a: string[], b: string[]): Relation {
  const ab = implies(a, b);
  const ba = implies(b, a);
  if (ab && ba) return 'identical';
  if (ab) return 'narrower';
  if (ba) return 'broader';
  return 'unrelated';
}

/** Split a stored predicate back into its conditions (it is already normalised). */
export function conditionsOf(predicate: string): string[] {
  return predicate
    .split('&&')
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Rung 7 creates an audience, but a NEW audience is a human decision. Anything
 *  below this stays unapproved even when the ladder is confident about it. */
export const AUTO_APPROVE_CONFIDENCE = 0.8;
/** Rung 5: how close two audience descriptions must be to reach the judge. */
export const SIMILARITY_MAX = 0.35;
/** Rung 6 will not merge on a hesitant answer. */
export const JUDGE_MIN_CONFIDENCE = 0.7;

@Injectable()
export class AudienceResolverService {
  private readonly log = new Logger('AudienceResolver');

  constructor(
    @InjectRepository(Audience)
    private readonly audiences: Repository<Audience>,
    @InjectRepository(AudienceEdge)
    private readonly edges: Repository<AudienceEdge>,
    private readonly ai: AiClientService,
  ) {}

  /** Pattern C: one call per document, over the title and opening clauses. */
  async resolveDocument(
    docId: string,
    title: string | null,
    openingClauses: string[],
    store: AudienceStore = this.dbStore(),
  ): Promise<(AudienceResolution & { ai: AiAudience }) | null> {
    const answer = await this.ai.documentAudience(docId, title, openingClauses);
    if (!answer.resolved || !answer.predicate_hash) {
      // Deliberately not a fallback to "everyone". A wrong floor puts duties on
      // firms that do not owe them; no floor leaves the clauses visibly
      // unassigned, which someone can see and fix.
      this.log.warn(
        `${docId}: no document audience (${answer.error ?? 'nothing named'})`,
      );
      return null;
    }
    const resolution = await this.resolve(
      {
        label: answer.label,
        predicate: answer.normalised,
        predicateHash: answer.predicate_hash,
        conditions: answer.conditions,
        properties: answer.conditions.map((c) => c.split(' ')[0]),
        confidence: answer.confidence,
        pattern: 'C',
        createdFrom: docId,
      },
      store,
    );
    return { ...resolution, ai: answer };
  }

  /**
   * The ladder itself.
   *
   * Rungs 3 and 4 compare TESTS and are exact — they prove sameness rather than
   * guessing it, and they need no vector at all. Rungs 5 and 6 exist for the
   * case neither can see: the model phrased the same group using a DIFFERENT
   * property, so the strings differ and neither implies the other.
   *
   * D2 measured that rungs 3 and 4 settled all 24 chapter audiences alone,
   * because composition happens in code against a fixed vocabulary. That holds
   * exactly as long as the vocabulary is fixed — and stops holding the moment a
   * live model is free to name a new property, which is what the gpt-4o run
   * does. Hence these rungs.
   *
   * ⚠️ Rung 6 can MERGE two groups of firms, which is the duplicate-branch
   * failure in reverse: one group inherits another's obligations and nothing
   * downstream detects it. So the judge is asked a narrow question about the
   * TEST, never the name, and its "different" answer is the safe default.
   */
  async resolve(
    candidate: {
      label: string;
      predicate: string;
      predicateHash: string;
      conditions: string[];
      properties: string[];
      confidence: number;
      pattern: string;
      createdFrom?: string;
    },
    store: AudienceStore = this.dbStore(),
  ): Promise<AudienceResolution> {
    // ── RUNG 3 — exact match on the normalised test ──────────────────────────
    const exact = await store.findByHash(candidate.predicateHash);
    if (exact) {
      if (candidate.label && !exact.aliases.includes(candidate.label)) {
        await store.addAlias(exact.id, candidate.label);
      }
      return {
        audience: exact,
        rung: 'exact',
        broaderThan: [],
        narrowerThan: [],
        confidence: 1, // provably the same set of firms
        needsApproval: false,
      };
    }

    // ── RUNG 4 — logical implication ─────────────────────────────────────────
    const existing = await store.all();
    const narrowerThan: number[] = [];
    const broaderThan: number[] = [];
    for (const other of existing) {
      const relation = compare(candidate.conditions, conditionsOf(other.predicate));
      if (relation === 'identical') {
        // Different hash, same set — only reachable if normalisation missed
        // something. Reuse and say so, because two nodes for one set splits the
        // rules across both.
        this.log.warn(
          `identical-but-unhashed audience: "${candidate.predicate}" == "${other.predicate}"`,
        );
        await store.addAlias(other.id, candidate.label);
        return {
          audience: other,
          rung: 'implication',
          broaderThan: [],
          narrowerThan: [],
          confidence: 1,
          needsApproval: false,
        };
      }
      if (relation === 'narrower') narrowerThan.push(other.id);
      if (relation === 'broader') broaderThan.push(other.id);
    }

    // ── RUNG 5 — meaning similarity ─────────────────────────────────────────
    // Only reached when both exact rungs failed. It does not decide anything: it
    // produces a SHORTLIST for rung 6, because a distance is evidence that two
    // audiences might be the same and never proof.
    const shortlist = await store.nearest?.(candidate.predicate, SIMILARITY_MAX, 3);
    if (shortlist && shortlist.length) {
      // ── RUNG 6 — the judge, on ≤3 candidates ──────────────────────────────
      const verdict = await this.ai.judgeAudience(
        { label: candidate.label, predicate: candidate.predicate },
        shortlist.map((a) => ({ id: a.id, label: a.label, predicate: a.predicate })),
      );
      if (
        verdict.same &&
        verdict.match_index >= 0 &&
        verdict.match_index < shortlist.length &&
        verdict.confidence >= JUDGE_MIN_CONFIDENCE
      ) {
        const hit = shortlist[verdict.match_index];
        this.log.log(
          `rung 6 merged "${candidate.label}" into "${hit.label}" ` +
            `(${verdict.confidence.toFixed(2)}): ${verdict.why ?? ''}`,
        );
        await store.addAlias(hit.id, candidate.label);
        return {
          audience: hit,
          rung: 'similarity',
          broaderThan: [],
          narrowerThan: [],
          // NOT 1. Rungs 3 and 4 PROVE sameness; this one was judged, and the
          // difference has to survive into the record.
          confidence: verdict.confidence,
          needsApproval: verdict.confidence < AUTO_APPROVE_CONFIDENCE,
        };
      }
    }

    // ── RUNG 7 — a new audience ──────────────────────────────────────────────
    const created = await store.create({
      label: candidate.label,
      predicate: candidate.predicate,
      predicateHash: candidate.predicateHash,
      properties: Array.from(new Set(candidate.properties)),
      aliases: [],
      pattern: candidate.pattern,
      createdFrom: candidate.createdFrom,
      confidence: candidate.confidence,
    });

    // Record containment both ways so the lattice stays a DAG, not a tree.
    for (const broader of narrowerThan) {
      await store.link(created.id, broader, 'implication');
    }
    for (const narrower of broaderThan) {
      await store.link(narrower, created.id, 'implication');
    }

    return {
      audience: created,
      rung: 'created',
      broaderThan,
      narrowerThan,
      confidence: candidate.confidence,
      needsApproval: candidate.confidence < AUTO_APPROVE_CONFIDENCE,
    };
  }

  /** The real, database-backed store. */
  dbStore(): AudienceStore {
    return {
      findByHash: async (hash) =>
        (await this.audiences.findOneBy({ predicateHash: hash })) ?? null,
      all: async () => this.audiences.find(),
      create: async (row) => {
        const entity = this.audiences.create({
          label: row.label,
          predicate: row.predicate,
          predicateHash: row.predicateHash,
          properties: row.properties,
          aliases: row.aliases,
          pattern: row.pattern ?? undefined,
          createdFrom: row.createdFrom,
          confidence: row.confidence,
          // Step 10e. The gate is a threshold, not a ceremony: a confident
          // translation of "Obligations of QSBs" does not need a human, and a
          // queue that fills with those is a queue nobody reads.
          state:
            (row.confidence ?? 0) >= AUTO_APPROVE_CONFIDENCE ? 'APPROVED' : 'PROPOSED',
        });
        const created = await this.audiences.save(entity);
        // Embedded IMMEDIATELY, like a new attribute. An audience created and
        // not embedded is invisible to rung 5, so the very next differently
        // phrased heading creates a duplicate of it — the failure these rungs
        // exist to prevent, reintroduced by an ordering slip.
        try {
          const text = `${row.label}. ${row.predicate}`;
          const { embeddings } = await this.ai.embed([text]);
          const vector = embeddings[0];
          if (vector) {
            await this.audiences.query(
              `UPDATE audiences SET embedding = $2::vector, embedded_text = $3 WHERE id = $1`,
              [created.id, JSON.stringify(vector), text],
            );
          }
        } catch (err) {
          // A failed embedding must not lose the audience. It degrades rung 5
          // for this row and nothing else.
          this.log.warn(`audience ${created.id} not embedded: ${(err as Error).message}`);
        }
        return created;
      },
      addAlias: async (id, alias) => {
        const row = await this.audiences.findOneBy({ id });
        if (!row || !alias || row.aliases.includes(alias)) return;
        row.aliases = [...row.aliases, alias];
        await this.audiences.save(row);
      },
      nearest: async (predicate, maxDistance, limit) => {
        const { embeddings } = await this.ai.embed([predicate]);
        const vector = embeddings[0];
        if (!vector) return [];
        const rows: { id: number }[] = await this.audiences.query(
          `SELECT id, (embedding <=> $1::vector) AS distance
             FROM audiences
            WHERE embedding IS NOT NULL
              AND (embedding <=> $1::vector) <= $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          [JSON.stringify(vector), maxDistance, limit],
        );
        if (!rows.length) return [];
        return this.audiences.findByIds(rows.map((r) => r.id));
      },
      link: async (narrowerId, broaderId, derivation) => {
        const existing = await this.edges.findOneBy({ narrowerId, broaderId });
        if (existing) return;
        await this.edges.save(this.edges.create({ narrowerId, broaderId, derivation }));
      },
    };
  }
}
