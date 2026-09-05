import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Obligation } from '../database/entities/obligation.entity';
import { ObligationVersion } from '../database/entities/obligation-version.entity';
import { RuleAssertion } from '../database/entities/rule-assertion.entity';
import {
  Citation,
  Decision,
  Graph,
  IncomingRule,
  ProjectedRule,
  apply,
  classify,
  emptyGraph,
} from './filing.engine';

export interface FilingInput {
  key: string;
  row: Obligation;
  clauseId?: number;
  clauseNo?: string | null;
  citations?: Citation[];
}

export interface FilingSummary {
  filed: number;
  restatement: number;
  amendment: number;
  new: number;
  repeal: number;
  ambiguous: number;
  /** Rows that should actually be inserted — restatements and amendments are not. */
  insert: Obligation[];
  review: { key: string; reason: string; candidates: string[] }[];
}

/**
 * Step 15 — the database side of filing.
 *
 * The decisions themselves live in filing.engine.ts and are pure. This class
 * does three things and nothing else:
 *
 *   1. builds the current projection from the live `obligations` table
 *   2. asks the engine for a verdict per rule
 *   3. appends an assertion for EVERY rule, whatever the verdict
 *
 * Point 3 is the one that matters. The log is written even for restatements and
 * ambiguities, because the log — not the graph — is the record. The graph can be
 * rebuilt from it; it cannot be rebuilt from itself.
 */
@Injectable()
export class FilingService {
  private readonly log = new Logger('Filing');

  constructor(
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
    @InjectRepository(ObligationVersion)
    private readonly versions: Repository<ObligationVersion>,
    @InjectRepository(RuleAssertion) private readonly assertions: Repository<RuleAssertion>,
  ) {}

  /**
   * The live graph, as the projection currently stands.
   *
   * A document's own previous rules are already gone by this point:
   * deleteDocRows() runs at store_clauses, so a re-ingest never compares a rule
   * against the previous version of itself.
   */
  private async currentGraph(): Promise<Graph> {
    const rows: {
      id: number;
      identity_hash: string | null;
      full_hash: string | null;
      audience_id: number | null;
      attribute_ids: number[];
      state: string;
      title: string;
      version: number;
    }[] = await this.obligations.query(
      `SELECT id, identity_hash, full_hash, audience_id, attribute_ids,
              state, title, version
         FROM obligations
        WHERE identity_hash IS NOT NULL AND state <> 'SUPERSEDED'`,
    );

    const graph = emptyGraph();
    for (const r of rows) {
      const rule: ProjectedRule = {
        id: String(r.id),
        identityHash: r.identity_hash as string,
        fullHash: r.full_hash ?? '',
        audienceId: r.audience_id,
        attributeIds: r.attribute_ids ?? [],
        version: r.version,
        state: r.state === 'SUPERSEDED' ? 'SUPERSEDED' : 'ACTIVE',
        title: r.title,
        sourceDocs: [],
        effectiveFrom: '',
      };
      graph.rules.set(rule.id, rule);
    }
    return graph;
  }

  /**
   * File one document's rules.
   *
   * `effectiveFrom` is the date the circular takes effect, NOT the ingestion
   * date — it is the replay sort key, and getting it wrong reorders history.
   */
  async fileDocument(
    docId: string,
    inputs: FilingInput[],
    effectiveFrom: string,
  ): Promise<FilingSummary> {
    const graph = await this.currentGraph();
    const summary: FilingSummary = {
      filed: 0,
      restatement: 0,
      amendment: 0,
      new: 0,
      repeal: 0,
      ambiguous: 0,
      insert: [],
      review: [],
    };

    const toAppend: Partial<RuleAssertion>[] = [];
    const stagedVersions: Partial<ObligationVersion>[] = [];
    const restated: { id: number; docId: string }[] = [];
    const repealed: number[] = [];

    for (const input of inputs) {
      const incoming: IncomingRule = {
        key: input.key,
        docId,
        clauseNo: input.clauseNo,
        identityHash: input.row.identityHash,
        fullHash: input.row.fullHash,
        audienceId: input.row.audienceId ?? null,
        attributeIds: input.row.attributeIds ?? [],
        effectiveFrom,
        citations: input.citations,
        title: input.row.title,
      };

      const decision: Decision = classify(incoming, graph);
      apply(incoming, decision, graph);
      summary.filed += 1;
      summary[decision.verdict] += 1;

      // A target is either a row already in the database (numeric id) or a rule
      // filed EARLIER IN THIS SAME DOCUMENT, whose id is `docId#key` because it
      // has not been inserted yet. Both are legitimate — a circular does restate
      // itself — but they need different handling, and conflating them sends
      // "FILE-A#3" to an integer column.
      const targetId =
        decision.targetId && /^\d+$/.test(decision.targetId)
          ? Number(decision.targetId)
          : null;
      const targetIsInRun = Boolean(decision.targetId) && targetId === null;
      toAppend.push({
        docId,
        clauseId: input.clauseId,
        obligationId: targetId ?? undefined, // null for an in-run target
        audienceId: input.row.audienceId ?? undefined,
        identityHash: input.row.identityHash,
        fullHash: input.row.fullHash,
        verdict: decision.verdict,
        lane: decision.lane,
        effectiveFrom,
        payload: {
          title: input.row.title,
          rule_expression: input.row.ruleExpression,
          attribute_ids: input.row.attributeIds,
          candidates: decision.candidates ?? [],
        },
        note: decision.reason,
      });

      switch (decision.verdict) {
        case 'new':
          summary.insert.push(input.row);
          break;
        case 'restatement':
          // Either way nothing new is inserted. Against a stored rule this adds
          // provenance; against one filed moments ago in this same document it
          // just means the circular said the same thing twice, and one
          // obligation is the right answer.
          if (targetId) restated.push({ id: targetId, docId });
          break;
        case 'amendment':
          if (targetIsInRun) {
            // One document stating the same duty twice with DIFFERENT values.
            // There is no "before" to stage against, and picking one silently
            // would be a coin flip on a live obligation — so it goes to review.
            summary.amendment -= 1;
            summary.ambiguous += 1;
            summary.review.push({
              key: input.key,
              reason: 'the same duty appears twice in this document with different values',
              candidates: [decision.targetId as string],
            });
            break;
          }
          if (targetId) {
            const target = graph.rules.get(String(targetId));
            stagedVersions.push({
              obligationId: targetId,
              version: (target?.version ?? 1) + 1,
              supersededReason: `staged by ${docId} (${decision.lane})`,
              snapshot: {
                proposed: true,
                from_full_hash: target?.fullHash,
                to_full_hash: input.row.fullHash,
                rule_expression: input.row.ruleExpression,
                asserted_by: docId,
                effective_from: effectiveFrom,
              },
            });
          }
          break;
        case 'repeal':
          if (targetId) repealed.push(targetId);
          break;
        case 'ambiguous':
          summary.review.push({
            key: input.key,
            reason: decision.reason ?? 'ambiguous',
            candidates: decision.candidates ?? [],
          });
          break;
      }
    }

    // The log is appended for EVERY rule, including the ones that changed
    // nothing. It is the record; the graph is only a projection of it.
    for (let i = 0; i < toAppend.length; i += 200) {
      await this.assertions.save(
        toAppend.slice(i, i + 200).map((a) => this.assertions.create(a)),
      );
    }

    if (stagedVersions.length) {
      // PROPOSED, not applied. The old version stays ACTIVE until a human
      // approves — the approval step is the product, not a safety net.
      await this.versions.save(stagedVersions.map((v) => this.versions.create(v)));
    }

    if (repealed.length) {
      await this.obligations.query(
        `UPDATE obligations SET state = 'SUPERSEDED' WHERE id = ANY($1::int[])`,
        [repealed],
      );
    }

    // Provenance only: this circular also says it. Guarded both ways — the set
    // is deduped here, and the UPDATE refuses to append a span the row already
    // carries — because one document can restate one obligation several times
    // and "said it twice" is not two pieces of provenance.
    for (const id of new Set(restated.map((r) => r.id))) {
      await this.obligations.query(
        `UPDATE obligations
            SET source_spans = source_spans || jsonb_build_array(
                  jsonb_build_object('restated_by', $2::text))
          WHERE id = $1
            AND NOT source_spans @> jsonb_build_array(
                  jsonb_build_object('restated_by', $2::text))`,
        [id, docId],
      );
    }

    return summary;
  }

  /** Every assertion ever made about a document, in replay order. */
  async assertionsFor(docId: string): Promise<RuleAssertion[]> {
    return this.assertions.find({
      where: { docId },
      order: { effectiveFrom: 'ASC', seq: 'ASC' },
    });
  }
}
