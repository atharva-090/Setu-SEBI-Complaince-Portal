import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { Attribute } from '../database/entities/attribute.entity';
import { DataType } from '../database/entities/enums';
import { AiClientService, AiClause, AiRule } from './ai-client.service';
import { typeGate, typesCompatible } from './type-gate';

// Meaning-distance thresholds (cosine distance on the composite embedding).
// Frozen starting point (TASKS.md M3); calibrate on a labelled set once real
// embeddings exist — meaningless under mock pseudo-embeddings.
const REUSE_MAX = 0.15; // < 0.15            → reuse, no AI
const JUDGE_MAX = 0.45; // 0.15 .. 0.45      → ask the judge; > 0.45 → new

export interface ResolveStats {
  tokens: number; // token occurrences seen
  reused: number; // resolved to an existing attribute (incl. judge-reuse)
  created: number; // new attribute rows
  judged: number; // tokens that reached the AI judge
  tripwired: number; // same-name collisions that forced a judge
  typeGated: number; // candidates discarded for a type or unit mismatch (Step 13, step 4)
}

/** A resolved attribute, enough to rewrite the expression and build hashes. */
interface ResolvedAttr {
  id: number;
  category: string;
  canonicalName: string;
}

interface Candidate {
  id: number;
  category: string;
  canonical_name: string;
  aliases: string[];
  description: string;
  /** The type gate reads these; without them a date could merge with a count. */
  dataType: string;
  unit: string | null;
  distance: number; // 0 for a name-tripwire hit (distance is not the reason it's here)
}

export interface ResolveOutput {
  attributeIds: number[];
  canonicalExpression: string;
  /** canonical ref name -> registry id, for Step 14's fingerprint call. */
  refIds: Record<string, number>;
}

/**
 * M3 — the attribute-resolution funnel. Turns each free-text token a rule uses
 * (e.g. `last_audit_date`) into a canonical entry in the shared `attributes`
 * registry, so the same real-world data-point exists ONCE no matter how many
 * circulars name it differently. One mechanism does the matching: vector search
 * over a single composite embedding per token (name + meaning + topic). The old
 * name lane survives only as a same-name *tripwire* that can force a judge — never
 * a match path of its own.
 *
 * Resolution is sequential by design: a token that creates a new attribute must be
 * visible to the next token's search within the same run, so cross-circular (and
 * within-run) dedup actually happens.
 */
@Injectable()
export class AttributeResolverService {
  private readonly log = new Logger('AttributeResolver');

  constructor(
    @InjectRepository(Attribute) private readonly attrs: Repository<Attribute>,
    private readonly ai: AiClientService,
  ) {}

  /** The one string that gets embedded per token — name + meaning + topic. */
  static composite(name: string, meaning: string, topic: string): string {
    return `name: ${name}. meaning: ${meaning || ''}. topic: ${topic || ''}`;
  }

  /**
   * Resolve every token in one rule, rewrite the expression to canonical refs, and
   * compute the identity/full fingerprints. `vecByComposite` holds a pre-batched
   * embedding for each token's composite string; `memo` collapses identical
   * composites already resolved earlier in this run.
   */
  async resolve(
    docId: string,
    rule: AiRule,
    clause: AiClause | undefined,
    vecByComposite: Map<string, number[]>,
    memo: Map<string, ResolvedAttr>,
    stats: ResolveStats,
  ): Promise<ResolveOutput> {
    const topic = rule.context || '';
    const hints = rule.attribute_hints || {};
    const tokenMap = new Map<string, ResolvedAttr>();

    for (const [token, hint] of Object.entries(hints)) {
      stats.tokens += 1;
      const composite = AttributeResolverService.composite(token, hint?.meaning || '', topic);

      const cached = memo.get(composite);
      if (cached) {
        stats.reused += 1;
        tokenMap.set(token, cached);
        continue;
      }

      const vec = vecByComposite.get(composite) || null;
      const resolved = await this.resolveToken(docId, clause, token, hint, topic, vec, stats);
      tokenMap.set(token, resolved);
      memo.set(composite, resolved);
    }

    const canonicalExpression = this.rewrite(rule.rule_expression, tokenMap);
    const attributeIds = [...new Set([...tokenMap.values()].map((a) => a.id))];
    // Step 14 does the fingerprinting now, in the AI service, because it needs
    // the expression TREE and the audience id — neither of which exists here.
    const refIds: Record<string, number> = {};
    for (const attr of tokenMap.values()) {
      refIds[`${attr.category}.${attr.canonicalName}`] = attr.id;
    }
    return { attributeIds, canonicalExpression, refIds };
  }

  private async resolveToken(
    docId: string,
    clause: AiClause | undefined,
    token: string,
    hint: { data_type?: string; meaning?: string; unit?: string } | undefined,
    topic: string,
    vec: number[] | null,
    stats: ResolveStats,
  ): Promise<ResolvedAttr> {
    const found = vec ? await this.vectorSearch(vec) : [];

    // ── STEP 4 — THE TYPE GATE ──────────────────────────────────────────────
    // Before the distance decision, never after. A gate applied to the winner
    // alone would let a mistyped candidate at 0.02 crowd out a correctly typed
    // one at 0.06 and then be thrown away, leaving a create where a reuse was
    // right. Filtering the LIST is what makes the second-best reachable.
    const gated = typeGate(found, hint);
    const candidates = gated.kept;
    stats.typeGated += gated.rejected.length;
    if (gated.rejected.length && gated.rejected[0].id === found[0]?.id) {
      // The nearest neighbour by meaning was the wrong TYPE. That is the merge
      // this gate exists to prevent, so it is worth seeing in the log.
      this.log.debug(
        `type gate: "${token}" (${hint?.data_type ?? '?'}) rejected #${gated.rejected[0].id} ` +
          `(${gated.rejected[0].was}) at distance ${found[0].distance.toFixed(3)}`,
      );
    }

    const trip = await this.tripwire(token);
    const nearest = candidates[0];

    // ── decision ───────────────────────────────────────────────────────────
    // A same-name hit always forces a judge: a silent create next to a same-named
    // attribute is how duplicate broker input fields get born.
    let decision: 'reuse' | 'judge' | 'new';
    // A same-name hit of a DIFFERENT type is not a candidate at all. Two facts
    // both called `last_audit_date`, one a date and one a document, are the
    // clearest possible split — sending that to the judge invites it to merge
    // them on the strength of the name, which is the one thing the funnel is
    // never allowed to decide on.
    const typedTrip = trip && typesCompatible(hint?.data_type, trip.dataType) ? trip : null;
    if (trip && !typedTrip) stats.typeGated += 1;

    if (typedTrip) {
      decision = 'judge';
      stats.tripwired += 1;
    } else if (!nearest) {
      decision = 'new';
    } else if (nearest.distance < REUSE_MAX) {
      decision = 'reuse';
    } else if (nearest.distance <= JUDGE_MAX) {
      decision = 'judge';
    } else {
      decision = 'new';
    }

    if (decision === 'reuse') {
      stats.reused += 1;
      await this.addAlias(nearest.id, token);
      return { id: nearest.id, category: nearest.category, canonicalName: nearest.canonical_name };
    }

    if (decision === 'judge') {
      stats.judged += 1;
      // ≤3 candidates: the nearest by meaning, plus the tripwire hit if any.
      const pool: Candidate[] = candidates.slice(0, 3);
      if (typedTrip && !pool.some((c) => c.id === typedTrip.id)) pool.unshift(typedTrip);
      const cand = pool.slice(0, 3);
      const verdict = await this.ai.judgeAttribute(
        { name: token, meaning: hint?.meaning || '', topic },
        cand.map((c) => ({ id: c.id, name: c.canonical_name, category: c.category, description: c.description })),
      );
      if (verdict.same && verdict.match_index >= 0 && verdict.match_index < cand.length) {
        const hit = cand[verdict.match_index];
        stats.reused += 1;
        await this.addAlias(hit.id, token);
        return { id: hit.id, category: hit.category, canonicalName: hit.canonical_name };
      }
      // judge says "different" → fall through to create a new attribute
    }

    stats.created += 1;
    return this.createAttribute(docId, clause, token, hint, topic, vec);
  }

  /** top-5 nearest attributes by composite-embedding cosine distance (HNSW). */
  private async vectorSearch(vec: number[]): Promise<Candidate[]> {
    const rows: Array<Record<string, unknown>> = await this.attrs.query(
      `SELECT id, category, canonical_name, aliases, description,
              data_type, unit,
              (embedding <=> $1::vector) AS distance
         FROM attributes
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        -- Ten, not five. The type gate discards candidates AFTER ranking, so a
        -- list of five mistyped neighbours would leave nothing to reuse and the
        -- funnel would create a duplicate of something already in the register.
        LIMIT 10`,
      [JSON.stringify(vec)],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      category: String(r.category),
      canonical_name: String(r.canonical_name),
      aliases: (r.aliases as string[]) || [],
      description: String(r.description ?? ''),
      dataType: String(r.data_type ?? ''),
      unit: (r.unit as string | null) ?? null,
      distance: Number(r.distance),
    }));
  }

  /** Same-name tripwire: exact canonical_name or alias match (btree + GIN). */
  private async tripwire(token: string): Promise<Candidate | null> {
    const rows: Array<Record<string, unknown>> = await this.attrs.query(
      `SELECT id, category, canonical_name, aliases, description, data_type, unit
         FROM attributes
        WHERE canonical_name = $1 OR $1 = ANY(aliases)
        LIMIT 1`,
      [token],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      category: String(r.category),
      canonical_name: String(r.canonical_name),
      aliases: (r.aliases as string[]) || [],
      description: String(r.description ?? ''),
      dataType: String(r.data_type ?? ''),
      unit: (r.unit as string | null) ?? null,
      distance: 0,
    };
  }

  /** Append the token spelling as provenance — an audit record, not a lookup key. */
  private async addAlias(id: number, token: string): Promise<void> {
    await this.attrs.query(
      `UPDATE attributes SET aliases = array_append(aliases, $2)
        WHERE id = $1 AND canonical_name <> $2 AND NOT ($2 = ANY(aliases))`,
      [id, token],
    );
  }

  private async createAttribute(
    docId: string,
    clause: AiClause | undefined,
    token: string,
    hint: { data_type?: string; meaning?: string; unit?: string } | undefined,
    topic: string,
    vec: number[] | null,
  ): Promise<ResolvedAttr> {
    const category = topic || 'general';
    const dataType = (hint?.data_type as DataType) || 'string';
    const saved = await this.attrs.save(
      this.attrs.create({
        category,
        canonicalName: token,
        dataType,
        unit: hint?.unit || undefined,
        description: hint?.meaning || token,
        aliases: [],
        createdFrom: `${docId}#${clause?.clause_no ?? clause?.idx ?? ''}`,
      }),
    );
    // embed its composite immediately so the next token can find it this run
    if (vec) {
      await this.attrs.query('UPDATE attributes SET embedding = $1::vector WHERE id = $2', [
        JSON.stringify(vec),
        saved.id,
      ]);
    }
    return { id: saved.id, category, canonicalName: token };
  }

  /** Swap every token in the expression for its `[Category.canonical_name]` ref. */
  private rewrite(expr: string, tokenMap: Map<string, ResolvedAttr>): string {
    let out = expr;
    // longest token first so a token that is a prefix of another can't clobber it
    const tokens = [...tokenMap.keys()].sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      const attr = tokenMap.get(token) as ResolvedAttr;
      const ref = `[${attr.category}.${attr.canonicalName}]`;
      out = out.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'g'), ref);
    }
    return out;
  }

  /**
   * The fingerprints used to be computed HERE, by masking the canonical
   * expression with regexes. That version hashed the expression alone, so the
   * QSB 180-day rule and the non-QSB 90-day rule both masked to `#4471<=NUM`
   * and collided — Step 15 would have filed the second as an amendment of the
   * first, silently collapsing two live duties into one wrong one.
   *
   * Step 14 replaced it: canonicalisation is a tree rewrite (flip comparisons,
   * sort commutative operands), so it lives with the parser in the AI service,
   * and the audience id enters the hash. See canonical.py.
   */
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(expr: string): string {
  return expr
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),<>=!+\-*/])\s*/g, '$1')
    .trim()
    .toLowerCase();
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
