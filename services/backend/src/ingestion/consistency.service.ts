import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Audience } from '../database/entities/audience.entity';
import { Obligation } from '../database/entities/obligation.entity';
import { conditionsOf } from './audience-resolver.service';
import {
  CheckedAudience,
  CheckedRule,
  Constraint,
  Report,
  runChecks,
} from './consistency.engine';

/**
 * Step 17 — the database side.
 *
 * ⚠️ This runs on the PROJECTION, not on an ingest. Every finding is a statement
 * about a PAIR of rules, and pairs cannot be evaluated while the graph is still
 * being built — so it runs after filing, over the whole graph, and re-runs
 * whenever a replay changes it. The graph is never checked once and then trusted
 * forever.
 */
@Injectable()
export class ConsistencyService {
  private readonly log = new Logger('Consistency');

  constructor(
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
    @InjectRepository(Audience) private readonly audiences: Repository<Audience>,
  ) {}

  async check(): Promise<Report & { skipped: { noConstraints: number } }> {
    const ruleRows: {
      id: number;
      title: string;
      state: string;
      identity_hash: string | null;
      audience_id: number | null;
      attribute_ids: number[] | null;
      hash_inputs: { constraints?: Constraint[] } | null;
      source_spans: unknown[] | null;
    }[] = await this.obligations.query(
      `SELECT id, title, state, identity_hash, audience_id, attribute_ids,
              hash_inputs, source_spans
         FROM obligations`,
    );

    let noConstraints = 0;
    const rules: CheckedRule[] = ruleRows.map((r) => {
      const constraints = r.hash_inputs?.constraints ?? [];
      // Rules fingerprinted before Step 17 existed carry no constraints. They
      // are still checked for redundancy, dead audiences and integrity — only
      // the interval comparison needs them. Re-deriving is cheap by design
      // (14d), and until then this number says how much of the graph is only
      // partly checked, rather than pretending it is fully checked.
      if (constraints.length === 0 && (r.state === 'ACTIVE' || r.state === 'REVIEW')) {
        noConstraints += 1;
      }
      return {
        id: r.id,
        title: r.title ?? '',
        state: r.state,
        identityHash: r.identity_hash,
        audienceId: r.audience_id,
        attributeIds: r.attribute_ids ?? [],
        constraints,
        sourceSpans: r.source_spans ?? [],
        docIds: [],
      };
    });

    const audienceRows = await this.audiences.find();
    const audiences = new Map<number, CheckedAudience>(
      audienceRows.map((a) => [
        a.id,
        { id: a.id, label: a.label, conditions: conditionsOf(a.predicate), state: a.state },
      ]),
    );

    const edgeRows: { id: number; from_id: number; to_id: number; type: string; state: string }[] =
      await this.obligations.query(`SELECT id, from_id, to_id, type, state FROM edges`);
    const edges = edgeRows.map((e) => ({
      id: e.id,
      fromId: e.from_id,
      toId: e.to_id,
      type: e.type,
      state: e.state,
    }));

    const report = runChecks(rules, audiences, edges);
    this.log.log(
      `checked ${report.checked.checked} rules (${report.checked.live} live) → ${report.findings.length} findings ` +
        `(${report.counts.CONTRADICTION} contradictions)`,
    );
    return { ...report, skipped: { noConstraints } };
  }
}
