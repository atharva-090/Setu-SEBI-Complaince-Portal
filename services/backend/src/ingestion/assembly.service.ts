import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Audience } from '../database/entities/audience.entity';
import { SourceClause } from '../database/entities/source-clause.entity';
import { conditionsOf } from './audience-resolver.service';
import {
  AssemblyRule,
  AssemblyResult,
  DraftedModifier,
  assemble,
  render,
} from './assembly.engine';
import { ClauseNode } from './links.engine';

/**
 * Step 12 — the database side of assembly.
 *
 * The decisions live in assembly.engine.ts and are pure. This class loads the
 * clause tree and the audience each clause ended up under (Step 10), asks the
 * engine, and hands the answers back to the orchestrator — which applies them
 * BEFORE fingerprinting.
 *
 * That ordering is the whole reason this is a separate phase rather than
 * something folded into extraction: a rule fingerprinted before its modifiers
 * are applied, then narrowed afterwards, is a phantom amendment of a duty nobody
 * amended.
 */
@Injectable()
export class AssemblyService {
  private readonly log = new Logger('Assembly');

  constructor(
    @InjectRepository(SourceClause) private readonly clauses: Repository<SourceClause>,
    @InjectRepository(Audience) private readonly audiences: Repository<Audience>,
  ) {}

  /**
   * The firm-property vocabulary, as the register actually uses it.
   *
   * Read from the audiences table rather than hard-coded: the engine's job is to
   * decide whether a modifier's condition is expressible, and "expressible"
   * means expressible in the vocabulary this deployment has approved, not in a
   * list compiled when the code was written.
   */
  private async vocabulary(): Promise<Set<string>> {
    const rows: { properties: string[] }[] = await this.audiences.query(
      `SELECT properties FROM audiences`,
    );
    const out = new Set<string>();
    for (const row of rows) for (const p of row.properties ?? []) out.add(p);
    // The base slice, always available even on an empty register.
    for (const p of [
      'regulator', 'category', 'is_mii', 'is_qsb', 'is_clearing_member',
      'holds_client_funds', 'provides_internet_trading', 'uses_cloud_services',
      'outsources_it', 'is_listed', 'active_clients', 'aum', 're_category',
    ]) {
      out.add(p);
    }
    return out;
  }

  /** The document's clauses, with the audience Step 10 left on each. */
  private async clauseContext(docId: string): Promise<{
    nodes: ClauseNode[];
    audienceByClause: Map<number, { id: number; conditions: string[] }>;
  }> {
    const rows: {
      id: number;
      clause_no: string | null;
      parent_id: number | null;
      audience_id: number | null;
      predicate: string | null;
    }[] = await this.clauses.query(
      `SELECT c.id, c.clause_no, c.parent_id, c.audience_id, a.predicate
         FROM source_clauses c
         LEFT JOIN audiences a ON a.id = c.audience_id
        WHERE c.doc_id = $1`,
      [docId],
    );
    const nodes: ClauseNode[] = rows.map((r) => ({
      id: r.id,
      clauseNo: r.clause_no,
      parentId: r.parent_id,
      citable: Boolean(r.clause_no),
      container: null,
    }));
    const audienceByClause = new Map<number, { id: number; conditions: string[] }>();
    for (const r of rows) {
      if (r.audience_id === null) continue;
      audienceByClause.set(r.id, {
        id: r.audience_id,
        conditions: conditionsOf(r.predicate ?? ''),
      });
    }
    return { nodes, audienceByClause };
  }

  async assembleDocument(
    docId: string,
    rules: { key: string; clauseId?: number; clauseNo?: string | null; title: string }[],
    modifiers: DraftedModifier[],
  ): Promise<AssemblyResult & { rendered: Map<string, string> }> {
    const { nodes, audienceByClause } = await this.clauseContext(docId);
    const vocabulary = await this.vocabulary();

    const input: AssemblyRule[] = rules.map((r) => {
      const audience = r.clauseId === undefined ? undefined : audienceByClause.get(r.clauseId);
      return {
        key: r.key,
        clauseId: r.clauseId ?? null,
        clauseNo: r.clauseNo ?? null,
        title: r.title,
        audienceConditions: audience?.conditions ?? [],
        audienceId: audience?.id ?? null,
      };
    });

    const result = assemble(input, modifiers, nodes, vocabulary);
    const rendered = new Map(result.rules.map((r) => [r.key, render(r.applicability)]));

    this.log.log(
      `${docId}: ${result.stats.modifiers} modifiers → ${result.stats.applied} applied ` +
        `(${result.stats.narrowedAudience} narrowed an audience, ` +
        `${result.stats.preconditionsAttached} carried as preconditions), ` +
        `${result.stats.orphaned} orphaned, ${result.flags.length} flags`,
    );
    return { ...result, rendered };
  }
}
