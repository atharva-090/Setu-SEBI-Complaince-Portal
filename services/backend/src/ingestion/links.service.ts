import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Edge } from '../database/entities/edge.entity';
import { Obligation } from '../database/entities/obligation.entity';
import { SourceClause } from '../database/entities/source-clause.entity';
import { UnresolvedCitation } from '../database/entities/unresolved-citation.entity';
import {
  ClauseNode,
  ExtractedCitation,
  LinkRule,
  ProposedEdge,
  admitEdges,
  proposeEdges,
  sharedEvidenceGroups,
  splitEdges,
  sweepCandidates,
} from './links.engine';

export interface LinkInput {
  /** Clause idx (AI-service numbering) → the citations found in it. */
  citationsByClauseIdx: Map<number, ExtractedCitation[]>;
  /** Clause idx → the row id it was stored as. */
  idByIdx: Map<number, number>;
}

export interface LinkSummary {
  citations: number;
  edges: { depends_on: number; amends: number; supersedes: number; split_of: number; shared_evidence: number };
  refused: { cycle: number };
  parked: number;
  swept: { resolved: number; abandoned: number };
}

/**
 * Step 16 — the database side of link resolution.
 *
 * It runs AFTER filing, and that ordering is not incidental: a link joins two
 * RULES, and rules do not exist until they are filed. Everything before this
 * point could be done per clause; this step is the first that needs ids.
 *
 * The decisions themselves live in links.engine.ts and are pure. This class
 * loads the graph, asks the engine, and writes what it is told — including the
 * refusals, because an edge refused for closing a cycle is a finding, not a
 * silent no-op.
 */
@Injectable()
export class LinksService {
  private readonly log = new Logger('Links');

  constructor(
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
    @InjectRepository(SourceClause) private readonly clauses: Repository<SourceClause>,
    @InjectRepository(Edge) private readonly edges: Repository<Edge>,
    @InjectRepository(UnresolvedCitation)
    private readonly citations: Repository<UnresolvedCitation>,
  ) {}

  /**
   * The clause tree, as the resolver needs it.
   *
   * Not scoped to one document: a citation routinely points at a clause of an
   * EARLIER circular, and scoping here would park every cross-document citation
   * as `absent` and never resolve one.
   */
  private async clauseNodes(): Promise<ClauseNode[]> {
    const rows: {
      id: number;
      clause_no: string | null;
      parent_id: number | null;
      heading: string | null;
      is_container: boolean;
      container: string | null;
    }[] = await this.clauses.query(`
      -- Walk DOWN from the roots, carrying the container label with us.
      --
      -- The obvious query — an ancestor chain per clause, then pick the nearest
      -- container out of it — is quadratic: a CTE has no index, so every one of
      -- the 7,752 clauses rescans the whole chain table. It did not finish. This
      -- one visits each clause once, and a child's own heading overrides its
      -- parent's via the COALESCE, which is what "nearest container wins" means.
      WITH RECURSIVE tree AS (
        SELECT c.id, c.parent_id, c.clause_no, c.heading,
               CASE WHEN c.heading ~* '^(annexure|appendix|schedule|form|chapter|part)[^a-z]'
                    THEN c.heading END AS container
          FROM source_clauses c
         WHERE c.parent_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM source_clauses p WHERE p.id = c.parent_id)
        UNION ALL
        SELECT c.id, c.parent_id, c.clause_no, c.heading,
               COALESCE(
                 CASE WHEN c.heading ~* '^(annexure|appendix|schedule|form|chapter|part)[^a-z]'
                      THEN c.heading END,
                 t.container)
          FROM source_clauses c JOIN tree t ON c.parent_id = t.id
      )
      SELECT id, clause_no, parent_id, heading,
             (clause_no IS NULL) AS is_container, container
        FROM tree`);

    return rows.map((r) => ({
      id: r.id,
      clauseNo: r.clause_no,
      parentId: r.parent_id,
      // Only a numbered clause is a citation target. A container heading and a
      // table-of-contents row can both carry the same number and neither is a
      // duty — linking to one would be an edge an auditor cannot justify.
      citable: Boolean(r.clause_no),
      container: r.container ? r.container.replace(/\s+/g, ' ').trim() : null,
    }));
  }

  private async linkRules(): Promise<LinkRule[]> {
    const rows: { id: number; source_clause_id: number | null; attribute_ids: number[] | null; state: string }[] =
      await this.obligations.query(
        `SELECT id, source_clause_id, attribute_ids, state
           FROM obligations WHERE state IN ('ACTIVE', 'REVIEW')`,
      );
    return rows.map((r) => ({
      id: r.id,
      clauseId: r.source_clause_id,
      attributeIds: r.attribute_ids ?? [],
      state: r.state,
    }));
  }

  private async existingEdges(): Promise<{ fromId: number; toId: number; type: string }[]> {
    const rows: { from_id: number; to_id: number; type: string }[] = await this.edges.query(
      `SELECT from_id, to_id, type FROM edges`,
    );
    return rows.map((e) => ({ fromId: e.from_id, toId: e.to_id, type: e.type }));
  }

  /**
   * Resolve one document's citations into edges, then sweep the parked queue.
   *
   * The sweep runs LAST and deliberately: this document's clauses are now in the
   * tree, so a citation parked by an earlier circular may be resolvable for the
   * first time. That is 16b — "who was waiting for me?"
   */
  async resolve(docId: string, input: LinkInput): Promise<LinkSummary> {
    const clauses = await this.clauseNodes();
    const rules = await this.linkRules();

    const flat: { clauseId: number; citation: ExtractedCitation }[] = [];
    for (const [idx, cites] of input.citationsByClauseIdx) {
      const clauseId = input.idByIdx.get(idx);
      if (clauseId === undefined) continue;
      for (const citation of cites) flat.push({ clauseId, citation });
    }

    const { edges: citationEdges, parked } = proposeEdges(flat, clauses, rules);

    // Structural and evidence links are derived from the graph, not the text, so
    // they are computed over every live rule rather than this document's.
    const structural = splitEdges(rules);
    const evidence: ProposedEdge[] = [];
    for (const group of sharedEvidenceGroups(rules)) {
      const [first, ...rest] = group.ruleIds;
      for (const other of rest) {
        evidence.push({
          fromId: other,
          toId: first,
          type: 'shared_evidence',
          state: 'ACTIVE',
          confidence: 1,
          sourceCitation: { kind: 'derived', shared_attributes: group.attributeIds },
        });
      }
    }

    const existing = await this.existingEdges();
    const { admitted, refused } = admitEdges(existing, [
      ...citationEdges,
      ...structural,
      ...evidence,
    ]);

    if (admitted.length) {
      await this.edges.save(
        admitted.map((e) =>
          this.edges.create({
            fromId: e.fromId,
            toId: e.toId,
            type: e.type,
            state: e.state,
            confidence: e.confidence,
            sourceCitation: e.sourceCitation,
          }),
        ),
        { chunk: 500 },
      );
    }
    for (const r of refused) {
      this.log.warn(
        `edge ${r.edge.fromId}->${r.edge.toId} (${r.edge.type}) refused: ${r.reason}. ` +
          `Refused at INSERT — by evaluation it would be an infinite loop in the hot path.`,
      );
    }

    // Park what did not resolve. `external` is NOT parked: a statute reference
    // will never be satisfied by an ingest, so queuing it would grow the queue
    // forever with rows that can only ever be abandoned.
    const toPark = parked.filter((p) => p.reason !== 'external');
    if (toPark.length) {
      await this.citations.save(
        toPark.map((p) =>
          this.citations.create({
            fromClauseId: p.fromClauseId ?? undefined,
            fromObligationId: p.fromRuleId ?? undefined,
            rawText: `${p.citation.raw} [${p.reason}]`.slice(0, 400),
            targetDoc: p.citation.targetDoc ?? undefined,
            targetContainer: p.citation.targetContainer ?? undefined,
            targetClauseNo: p.citation.number,
            edgeType:
              p.citation.kind === 'trigger'
                ? 'depends_on'
                : p.citation.kind === 'amends'
                  ? 'amends'
                  : p.citation.kind === 'supersedes'
                    ? 'supersedes'
                    : undefined,
            state: 'PENDING',
          }),
        ),
        { chunk: 500 },
      );
    }

    const swept = await this.sweep(docId, clauses, rules);

    const counts = { depends_on: 0, amends: 0, supersedes: 0, split_of: 0, shared_evidence: 0 };
    for (const e of admitted) counts[e.type] += 1;
    const summary: LinkSummary = {
      citations: flat.length,
      edges: counts,
      refused: { cycle: refused.filter((r) => r.reason === 'cycle').length },
      parked: toPark.length,
      swept,
    };
    this.log.log(
      `${docId}: ${flat.length} citations → ${admitted.length} edges ` +
        `(${counts.depends_on} depends_on), ${toPark.length} parked, ` +
        `${swept.resolved} swept in, ${refused.length} refused`,
    );
    return summary;
  }

  /**
   * 16b — "who was waiting for me?"
   *
   * A resolved citation can change a PAST filing verdict: a rule filed as NEW in
   * 2024 turns out to have amended a 2019 rule all along. With an event log that
   * is an appended correction and a replay, not history rewritten in place — the
   * second thing Step 15a's log bought, and not the reason it was chosen.
   */
  private async sweep(
    docId: string,
    clauses: ClauseNode[],
    rules: LinkRule[],
  ): Promise<{ resolved: number; abandoned: number }> {
    const rows: {
      id: number;
      from_clause_id: number | null;
      from_obligation_id: number | null;
      raw_text: string;
      target_doc: string | null;
      target_container: string | null;
      target_clause_no: string | null;
      edge_type: string | null;
      attempts: number;
    }[] = await this.citations.query(
      `SELECT id, from_clause_id, from_obligation_id, raw_text, target_doc,
              target_container, target_clause_no, edge_type, attempts
         FROM unresolved_citations WHERE state = 'PENDING'`,
    );
    if (rows.length === 0) return { resolved: 0, abandoned: 0 };

    const parked = rows.map((r) => ({
      id: r.id,
      fromClauseId: r.from_clause_id,
      fromObligationId: r.from_obligation_id,
      rawText: r.raw_text,
      targetDoc: r.target_doc,
      targetContainer: r.target_container,
      targetClauseNo: r.target_clause_no,
      edgeType: r.edge_type,
      attempts: r.attempts,
    }));
    const arrivedClauseIds = new Set(
      (
        await this.clauses.query(`SELECT id FROM source_clauses WHERE doc_id = $1`, [docId])
      ).map((r: { id: number }) => r.id),
    );
    const arrived = { docId, clauses: clauses.filter((c) => arrivedClauseIds.has(c.id)) };

    const { resolve, abandon } = sweepCandidates(parked, arrived);

    const rulesByClause = new Map<number, LinkRule[]>();
    for (const r of rules) {
      if (r.clauseId === null) continue;
      const list = rulesByClause.get(r.clauseId) ?? [];
      list.push(r);
      rulesByClause.set(r.clauseId, list);
    }

    const existing = await this.existingEdges();
    const proposals: ProposedEdge[] = [];
    const resolvedIds: number[] = [];
    for (const { parked: p, clauseId } of resolve) {
      const targets = rulesByClause.get(clauseId) ?? [];
      const source = p.fromObligationId;
      if (!source || targets.length === 0) continue;
      // Only depends_on is swept in automatically. An amends resolved late
      // changes a filing verdict, and that is a correction EVENT for Step 15 to
      // replay — not an edge this sweep may write on its own authority.
      if (p.edgeType !== 'depends_on') continue;
      for (const t of targets) {
        if (t.id === source) continue;
        proposals.push({
          fromId: source,
          toId: t.id,
          type: 'depends_on',
          state: 'ACTIVE',
          confidence: 0.8,
          sourceCitation: {
            raw: p.rawText,
            kind: 'trigger',
            resolved_by: 'sweep',
            arrived_doc: docId,
          },
        });
      }
      resolvedIds.push(p.id);
    }

    const { admitted } = admitEdges(existing, proposals);
    if (admitted.length) {
      await this.edges.save(
        admitted.map((e) => this.edges.create({ ...e })),
        { chunk: 500 },
      );
    }
    if (resolvedIds.length) {
      await this.citations.query(
        `UPDATE unresolved_citations SET state = 'RESOLVED', last_attempt_at = now()
          WHERE id = ANY($1::int[])`,
        [resolvedIds],
      );
    }
    if (abandon.length) {
      await this.citations.query(
        `UPDATE unresolved_citations
            SET state = 'ABANDONED', attempts = attempts + 1, last_attempt_at = now()
          WHERE id = ANY($1::int[])`,
        [abandon.map((p) => p.id)],
      );
    }
    // Everything else that was swept and missed has now been tried once more.
    const touched = [...resolvedIds, ...abandon.map((p) => p.id)];
    await this.citations.query(
      `UPDATE unresolved_citations
          SET attempts = attempts + 1, last_attempt_at = now()
        WHERE state = 'PENDING' AND NOT (id = ANY($1::int[]))`,
      [touched.length ? touched : [0]],
    );

    return { resolved: resolvedIds.length, abandoned: abandon.length };
  }
}
