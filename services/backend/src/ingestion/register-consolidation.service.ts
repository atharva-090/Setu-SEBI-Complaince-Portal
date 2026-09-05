import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../database/entities/attribute.entity';
import { Obligation } from '../database/entities/obligation.entity';
import { Mention, cluster, differByIndexOnly } from './coldstart.engine';
import { typesCompatible, unitsCompatible } from './type-gate';

export interface ConsolidationPlan {
  merges: {
    keepId: number;
    keepName: string;
    dropIds: number[];
    dropNames: string[];
    mentions: number;
    rationale: string;
  }[];
  stats: {
    attributes: number;
    withEmbedding: number;
    clusters: number;
    merges: number;
    attributesRemoved: number;
    rulesRepointed: number;
  };
}

/**
 * Step 13's cold-start half, applied to a register that already exists.
 *
 * The funnel resolves one token at a time against whatever is in the register,
 * which is right in steady state and wrong on a bulk load: whichever document
 * is processed first names everything forever, and every token that fails to
 * find its match creates a near-duplicate instead.
 *
 * Measured on the live graph after ingesting one master circular: **182 stems
 * split across 487 attributes**, including four separate rows all called
 * `inspection_report` and all of type `document`. A firm's intake form would
 * ask for the inspection report four times.
 *
 * ⚠️ This does NOT re-ingest and it does NOT call a model. Every attribute
 * already carries the embedding the funnel computed for it, so the clustering
 * that should have happened at bulk-load time can be done now, offline, over
 * exactly the same vectors. What it cannot recover is a name the register never
 * saw — consolidation merges what exists, it does not re-read the circular.
 *
 * Dry by default: `plan()` decides, `apply()` writes.
 */
@Injectable()
export class RegisterConsolidationService {
  private readonly log = new Logger('RegisterConsolidation');

  constructor(
    @InjectRepository(Attribute) private readonly attrs: Repository<Attribute>,
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
  ) {}

  /**
   * Which attributes are the same fact.
   *
   * The type gate applies here exactly as it does in the funnel: clustering by
   * meaning alone would fuse a date with a count, and at register scale it would
   * do it hundreds of times before anyone looked.
   */
  async plan(opts: { maxDistance?: number } = {}): Promise<ConsolidationPlan> {
    const rows: {
      id: number;
      canonical_name: string;
      data_type: string;
      unit: string | null;
      description: string;
      created_from: string | null;
      embedding: string | null;
      uses: number;
    }[] = await this.attrs.query(`
      SELECT a.id, a.canonical_name, a.data_type, a.unit, a.description,
             a.created_from, a.embedding::text AS embedding,
             (SELECT count(*)::int FROM obligations o WHERE a.id = ANY(o.attribute_ids)) AS uses
        FROM attributes a
       ORDER BY a.id
    `);

    const parse = (v: string | null): number[] | null => {
      if (!v) return null;
      try {
        return JSON.parse(v) as number[];
      } catch {
        return null;
      }
    };

    // One MENTION per use, so a name used 400 times outweighs one used once --
    // frequency is the dominant term in chooseName and it has to see the real
    // counts, not one row per distinct spelling.
    const mentions: Mention[] = [];
    const byToken = new Map<string, typeof rows>();
    let withEmbedding = 0;
    for (const r of rows) {
      const embedding = parse(r.embedding);
      if (embedding) withEmbedding += 1;
      const list = byToken.get(r.canonical_name) ?? [];
      list.push(r);
      byToken.set(r.canonical_name, list);
      const weight = Math.max(1, r.uses);
      for (let i = 0; i < weight; i += 1) {
        mentions.push({
          token: r.canonical_name,
          docId: r.created_from ?? 'unknown',
          effectiveFrom: '2024-01-01',
          dataType: r.data_type,
          unit: r.unit,
          meaning: r.description,
          embedding,
        });
      }
    }

    const { clusters, stats } = cluster(mentions, { max: opts.maxDistance ?? 0.12 });

    // A cluster names one surviving attribute; every other row whose name is in
    // that cluster is merged into it. Rows are only merged when the type gate
    // also permits it -- the clusterer checked the SEED, this checks each row.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const claimed = new Set<number>();
    const merges: ConsolidationPlan['merges'] = [];

    for (const c of clusters) {
      const names = [c.canonicalName, ...c.aliases];
      const candidates = names
        .flatMap((n) => byToken.get(n) ?? [])
        .filter((r) => !claimed.has(r.id));
      if (candidates.length < 2) continue;

      // Keep the most-used row bearing the winning name; ties go to the lowest
      // id, which is the oldest and therefore the one other things point at.
      const preferred = candidates
        .filter((r) => r.canonical_name === c.canonicalName)
        .sort((a, b) => b.uses - a.uses || a.id - b.id);
      const keep = preferred[0] ?? candidates.sort((a, b) => b.uses - a.uses || a.id - b.id)[0];

      const drop = candidates.filter(
        (r) =>
          r.id !== keep.id &&
          typesCompatible(r.data_type, keep.data_type) &&
          unitsCompatible(r.unit, keep.unit) &&
          // Checked again here, not only in the clusterer: this step also groups
          // by NAME, so an indexed pair could arrive without the clusterer ever
          // having compared them.
          !differByIndexOnly(r.canonical_name, keep.canonical_name),
      );
      if (drop.length === 0) continue;

      for (const r of [keep, ...drop]) claimed.add(r.id);
      merges.push({
        keepId: keep.id,
        keepName: keep.canonical_name,
        dropIds: drop.map((r) => r.id),
        dropNames: drop.map((r) => r.canonical_name),
        mentions: c.mentions,
        rationale: c.rationale,
      });
    }

    const dropIds = new Set(merges.flatMap((m) => m.dropIds));
    const affected: { n: string }[] = dropIds.size
      ? await this.obligations.query(
          `SELECT count(*)::text AS n FROM obligations WHERE attribute_ids && $1::int[]`,
          [[...dropIds]],
        )
      : [{ n: '0' }];

    return {
      merges,
      stats: {
        attributes: rows.length,
        withEmbedding,
        clusters: stats.clusters,
        merges: merges.length,
        attributesRemoved: dropIds.size,
        rulesRepointed: Number(affected[0]?.n ?? 0),
      },
    };
  }

  /**
   * Apply a plan: re-point every rule, fold the dropped names in as aliases,
   * then delete the duplicates.
   *
   * ⚠️ Order matters. Re-point BEFORE deleting, or a rule briefly references an
   * attribute that no longer exists. And the dropped spellings become aliases
   * on the survivor rather than being discarded -- they are how the next
   * document's token will find this attribute at rung 3 instead of creating the
   * duplicate all over again.
   *
   * Fingerprints are NOT recomputed here. `attribute_ids` entering the identity
   * hash means every re-pointed rule's hash is now stale, and re-deriving them
   * is `test/rederive.ts` -- a separate, idempotent step that reads stored
   * hash_inputs. Doing it here would hide a graph-wide change inside a cleanup.
   */
  async apply(plan: ConsolidationPlan): Promise<{ repointed: number; removed: number }> {
    let repointed = 0;
    let removed = 0;

    // ⚠️ ONE TRANSACTION for the whole plan.
    //
    // Without it a failure part-way leaves the register half-merged: some rules
    // re-pointed, some duplicates gone, and no record of where it stopped. That
    // happened on the first run -- a NOT NULL violation on `aliases` aborted the
    // 26th merge after 25 had already been written. It was recoverable only
    // because re-pointing happens BEFORE deleting, so nothing dangled; that is
    // luck, not a design, and this removes the need for the luck.
    const runner = this.attrs.manager.connection.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      for (const merge of plan.merges) {
        for (const dropId of merge.dropIds) {
          const res = await runner.query(
            `UPDATE obligations
                SET attribute_ids = (
                      SELECT array_agg(DISTINCT CASE WHEN x = $2 THEN $1 ELSE x END)
                        FROM unnest(attribute_ids) AS x)
              WHERE $2 = ANY(attribute_ids)`,
            [merge.keepId, dropId],
          );
          repointed += Array.isArray(res) ? Number(res[1] ?? 0) : 0;

          // ⚠️ `hash_inputs.ref_ids` MUST move too.
          //
          // It is the stored derivation -- token name to registry id -- and it
          // is what test/rederive.ts re-hashes from. Re-pointing attribute_ids
          // alone leaves the two disagreeing: the rule points at the survivor
          // while its fingerprint still says the id that was deleted, and the
          // re-derivation reports "0 rules changed" because it never sees the
          // move. Measured after the first apply: 122 rules in that state, and
          // the re-derive that was supposed to catch it said everything was fine.
          await runner.query(
            `UPDATE obligations o
                SET hash_inputs = jsonb_set(
                      o.hash_inputs, '{ref_ids}',
                      (SELECT jsonb_object_agg(kv.key,
                                to_jsonb(CASE WHEN kv.value::int = $2 THEN $1
                                              ELSE kv.value::int END))
                         FROM jsonb_each_text(o.hash_inputs -> 'ref_ids') kv))
              WHERE o.hash_inputs -> 'ref_ids' @> $3::jsonb
                 OR EXISTS (SELECT 1 FROM jsonb_each_text(o.hash_inputs -> 'ref_ids') kv
                             WHERE kv.value::int = $2)`,
            [merge.keepId, dropId, JSON.stringify({})],
          );
        }

        // coalesce, because array_agg over zero surviving rows returns NULL and
        // `aliases` is NOT NULL. A merge whose dropped names all equal the
        // survivor's own name is exactly that case.
        await runner.query(
          `UPDATE attributes
              SET aliases = coalesce((
                    SELECT array_agg(DISTINCT a)
                      FROM unnest(aliases || $2::text[]) AS a
                     WHERE a <> canonical_name), '{}')
            WHERE id = $1`,
          [merge.keepId, merge.dropNames],
        );

        const del = await runner.query(`DELETE FROM attributes WHERE id = ANY($1::int[])`, [
          merge.dropIds,
        ]);
        removed += Array.isArray(del) ? Number(del[1] ?? 0) : 0;
      }
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      this.log.error(`consolidation rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }

    this.log.warn(
      `register consolidated: ${removed} attributes merged away, ${repointed} rule rows ` +
        `re-pointed. Fingerprints are now STALE — run test/rederive.ts --apply.`,
    );
    return { repointed, removed };
  }
}
