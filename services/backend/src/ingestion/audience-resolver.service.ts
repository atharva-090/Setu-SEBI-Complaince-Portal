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
 *   RUNG 5  meaning similarity  ┐ not built — see resolve() note
 *   RUNG 6  AI judge            ┘
 *   RUNG 7  new audience                              → create (needs approval)
 */

export type Rung = 'exact' | 'implication' | 'created';

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
   * The ladder itself. Rungs 5 and 6 (meaning similarity, then an AI judge on
   * ≤3 borderline candidates) are NOT built: they need an embedding per
   * audience, and with Pattern C alone the register holds a handful of nodes
   * that rungs 3 and 4 settle exactly. They become necessary when D2 starts
   * minting chapter audiences phrased with different properties.
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
        return this.audiences.save(entity);
      },
      addAlias: async (id, alias) => {
        const row = await this.audiences.findOneBy({ id });
        if (!row || !alias || row.aliases.includes(alias)) return;
        row.aliases = [...row.aliases, alias];
        await this.audiences.save(row);
      },
      link: async (narrowerId, broaderId, derivation) => {
        const existing = await this.edges.findOneBy({ narrowerId, broaderId });
        if (existing) return;
        await this.edges.save(this.edges.create({ narrowerId, broaderId, derivation }));
      },
    };
  }
}
