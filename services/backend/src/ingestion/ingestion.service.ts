import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { Repository } from 'typeorm';
import { IngestionRun } from '../database/entities/ingestion-run.entity';
import { Obligation } from '../database/entities/obligation.entity';
import { SourceClause } from '../database/entities/source-clause.entity';
import { GovernanceState, ObligationType } from '../database/entities/enums';
import { AiClientService, AiClause, AiHeadingIn, AiModifier, AiRule } from './ai-client.service';
import { AssemblyService } from './assembly.service';
import { DraftedModifier } from './assembly.engine';
import { HeadingClause, headingLevels, nearestResolved, stampTree } from './pattern-a.engine';
import { AudienceResolverService, conditionsOf } from './audience-resolver.service';
import { ConsistencyService } from './consistency.service';
import { FilingInput, FilingService } from './filing.service';
import { LinksService } from './links.service';
import { AttributeResolverService, ResolveStats } from './attribute-resolver.service';
import { MongoService } from './mongo.service';

const CONFIDENCE_ACTIVE = 0.75; // scope §6: >= 0.75 → ACTIVE, else REVIEW
const EXTRACT_BATCH = 25; // windows per /extract call (progress granularity)
const EMBED_BATCH = 128;

export interface StageEvent {
  runId: string;
  status: string;
  stage: string;
  detail: Record<string, unknown>;
}

/** Pattern C reads the title plus this many opening clauses — nothing deeper. */
const PATTERN_C_OPENING_CLAUSES = 10;

/** Step 14 fingerprints, batched per HTTP call. */
const FINGERPRINT_BATCH = 200;

@Injectable()
export class IngestionService {
  private readonly log = new Logger('Ingestion');
  /** Live SSE feeds, one per active run. */
  private readonly streams = new Map<string, Subject<StageEvent>>();

  constructor(
    @InjectRepository(IngestionRun) private readonly runs: Repository<IngestionRun>,
    @InjectRepository(SourceClause) private readonly clauses: Repository<SourceClause>,
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
    private readonly mongo: MongoService,
    private readonly ai: AiClientService,
    private readonly resolver: AttributeResolverService,
    private readonly audienceResolver: AudienceResolverService,
    private readonly filing: FilingService,
    private readonly links: LinksService,
    private readonly assembly: AssemblyService,
    private readonly consistency: ConsistencyService,
  ) {}

  streamOf(runId: string): Subject<StageEvent> {
    let subject = this.streams.get(runId);
    if (!subject) {
      subject = new Subject<StageEvent>();
      this.streams.set(runId, subject);
    }
    return subject;
  }

  getRun(runId: string): Promise<IngestionRun | null> {
    return this.runs.findOneBy({ id: runId });
  }

  async createRun(docId: string): Promise<IngestionRun> {
    return this.runs.save(this.runs.create({ docId, status: 'pending', stages: {} }));
  }

  /** Fire-and-forget from the controller; all failures land on the run row. */
  async orchestrate(runId: string, docId: string, fileRef: string, filename: string) {
    const push = async (stage: string, detail: Record<string, unknown>, status = 'running') => {
      const run = await this.runs.findOneBy({ id: runId });
      if (!run) return;
      run.status = status;
      run.stages = { ...run.stages, [stage]: { ...detail, at: new Date().toISOString() } };
      if (status === 'completed' || status === 'failed') run.finishedAt = new Date();
      await this.runs.save(run);
      this.streamOf(runId).next({ runId, status, stage, detail });
    };

    try {
      // ── fetch ────────────────────────────────────────────────────────────
      await push('fetch_pdf', { state: 'running' });
      const pdf = await this.mongo.fetchPdf(fileRef);
      await push('fetch_pdf', { state: 'done', bytes: pdf.length });

      // ── Stage A/A2: parse → clause tree (+ numbering audit) ─────────────
      await push('parse', { state: 'running' });
      const parsed = await this.ai.parsePdf(docId, filename, pdf);
      await push('parse', { state: 'done', ...parsed.stats });

      // numbering audit — surface repairs and the flagged gaps for the console
      await push('numbering_audit', {
        state: 'done',
        checked: parsed.audit.checked,
        repaired: parsed.audit.repaired,
        flagged: parsed.audit.flagged,
        anomalies: parsed.audit.anomalies.filter((a) => a.resolution === 'flagged').slice(0, 25),
      });

      // ── store clauses (idempotent per doc: re-ingest replaces) ──────────
      await push('store_clauses', { state: 'running' });
      await this.deleteDocRows(docId);
      const idByIdx = await this.storeClauses(docId, parsed.clauses);
      await push('store_clauses', { state: 'done', rows: idByIdx.size });

      // ── Step 10a: Pattern C — the document's audience floor ─────────────
      // One AI call per DOCUMENT, not per clause, and it runs beside the
      // extraction chain rather than inside it: a window carries its audience
      // as wording, so drafting never waits for this. The floor is only needed
      // later, at filing.
      await push('audience', { state: 'running' });
      const audience = await this.stampDocumentAudience(docId, parsed.clauses);
      await push('audience', {
        state: 'done',
        ...(audience ?? { resolved: false }),
      });

      // ── Step 10b: Pattern A — chapter scoping ───────────────────────────
      // Narrows the floor wherever the document scopes by chapter. Every
      // heading is sent: the phrase gate that was designed to skip most of them
      // scored 0 of 148 on this very document, and its failure mode was silent.
      await push('chapter_audience', { state: 'running' });
      const chapters = await this.stampChapterAudiences(docId, parsed.clauses, idByIdx, audience);
      await push('chapter_audience', { state: 'done', ...chapters });

      // ── Stage B/C: extract rules ────────────────────────────────────────
      // Blocklist filter: send every clause that is NOT provable junk (the AI
      // service already set window_text on exactly those), in document order.
      const windows = parsed.clauses
        .filter((c) => c.window_text)
        .map((c) => ({
          idx: c.idx,
          clause_no: c.clause_no,
          page: c.page,
          char_start: c.char_start,
          char_end: c.char_end,
          window_text: c.window_text as string,
        }));

      await push('extract', { state: 'running', windows: windows.length, done: 0 });
      const clauseByIdx = new Map(parsed.clauses.map((c) => [c.idx, c]));
      let drafter = 'unknown';
      let extracted = 0;
      let failed = 0;
      const rows: Obligation[] = [];
      // each row kept next to the rule it came from — M3 needs the attribute hints
      const pending: { row: Obligation; rule: AiRule; clause?: AiClause }[] = [];
      const declinedIdx: number[] = []; // sent, but the drafter emitted no rule
      // Step 12's input, collected as it arrives and consumed only after the
      // whole extraction phase is done. Nothing here waits on anything, which
      // is exactly why extraction can be blindly parallel.
      const draftedModifiers: { idx: number; modifier: AiModifier }[] = [];

      for (let i = 0; i < windows.length; i += EXTRACT_BATCH) {
        const batch = windows.slice(i, i + EXTRACT_BATCH);
        const res = await this.ai.extract(docId, batch);
        drafter = res.drafter;
        for (const result of res.results) {
          if (result.error) {
            failed += 1;
            continue;
          }
          if (result.rules.length === 0) declinedIdx.push(result.idx);
          for (const m of result.modifiers ?? []) {
            draftedModifiers.push({ idx: result.idx, modifier: m });
          }
          const clause = clauseByIdx.get(result.idx);
          for (const rule of result.rules) {
            const row = this.toObligation(docId, rule, clause);
            // Which clause produced it. Step 16 resolves citations into edges by
            // walking clause → rules, and `source_spans` only carries the clause
            // NUMBER — which Decision 66 established is not a key.
            if (clause) row.sourceClauseId = idByIdx.get(clause.idx) as number;
            rows.push(row);
            pending.push({ row, rule, clause });
          }
        }
        extracted = Math.min(i + EXTRACT_BATCH, windows.length);
        await push('extract', {
          state: 'running',
          windows: windows.length,
          done: extracted,
          rules: rows.length,
          drafter,
        });
      }
      await push('extract', {
        state: 'done',
        windows: windows.length,
        rules: rows.length,
        declined: declinedIdx.length,
        failed_windows: failed,
        drafter,
      });

      // ── recall audit: a no-rule clause that still contains numbers is suspicious ─
      const recall = this.recallAudit(parsed.clauses, clauseByIdx, declinedIdx);
      await push('recall_audit', {
        state: 'done',
        swept: recall.swept,
        flagged: recall.flagged.length,
        samples: recall.flagged.slice(0, 25),
      });

      // ── Step 12: assembly ───────────────────────────────────────────────
      // The phase boundary. Extraction finished COMPLETELY above; only now is
      // any of it consumed. Modifiers are applied and the audience settled here,
      // and the fingerprint is taken in the NEXT stage — a rule fingerprinted
      // before its modifiers are applied and narrowed afterwards is a phantom
      // amendment of a duty nobody amended. The ordering is satisfied by the
      // sequence itself rather than by anyone remembering it.
      await push('assembly', { state: 'running', modifiers: draftedModifiers.length });
      const assembled = await this.assembly.assembleDocument(
        docId,
        pending.map((p, i) => ({
          key: String(i),
          clauseId: p.clause ? idByIdx.get(p.clause.idx) : undefined,
          clauseNo: p.clause?.clause_no ?? null,
          title: p.row.title,
        })),
        draftedModifiers.map(({ idx, modifier }): DraftedModifier => ({
          fromClauseNo: clauseByIdx.get(idx)?.clause_no ?? null,
          fromClauseId: idByIdx.get(idx) ?? null,
          effect: modifier.effect,
          targets: modifier.targets,
          condition: modifier.condition ?? '',
          scopeNote: modifier.scope_note ?? undefined,
          overrideValue: modifier.value ?? undefined,
          raw: modifier.raw,
          confidence: modifier.confidence,
        })),
      );
      const applied = await this.applyAssembly(docId, pending, assembled);
      await push('assembly', {
        state: 'done',
        ...assembled.stats,
        audience_narrowed: applied.narrowed,
        flags: assembled.flags.length,
        by_flag: assembled.flags.reduce<Record<string, number>>((acc, f) => {
          acc[f.kind] = (acc[f.kind] ?? 0) + 1;
          return acc;
        }, {}),
        derived: assembled.derived.length,
        samples: assembled.flags.slice(0, 10).map((f) => ({
          kind: f.kind,
          from: f.modifierFrom,
          message: f.message.slice(0, 160),
        })),
      });

      // ── Step 13d: promote preconditions to audiences ────────────────────
      // The drafter returns a precondition already in audience-test form
      // ("holds_client_funds == true"), so it goes through the SAME ladder,
      // intersected with the rule's current audience. A precondition that
      // resolves becomes part of who the rule applies to and is then dropped as
      // redundant; one that cannot be expressed leaves the rule in REVIEW,
      // exactly as at Step 12's Problem 2.
      await push('preconditions', { state: 'running' });
      const promoted = await this.promotePreconditions(docId, pending);
      await push('preconditions', { state: 'done', ...promoted });

      // ── M3: attribute funnel → canonical rewrite + fingerprints ─────────
      await push('resolve_attributes', { state: 'running', obligations: pending.length });
      const resolved = await this.resolveAttributes(docId, pending);
      await push('resolve_attributes', { state: 'done', ...resolved });

      // ── store obligations ────────────────────────────────────────────────
      await push('store_obligations', { state: 'running' });
      // ── Step 15: filing ─────────────────────────────────────────────────
      // Until now every rule inserted as new — the fingerprints were written and
      // never read. Filing decides whether each rule is new, a restatement of
      // something already known, or a change to a live obligation, and appends
      // an assertion for ALL of them. Amendments are STAGED, never applied.
      await push('filing', { state: 'running', rules: rows.length });
      const effectiveFrom = this.effectiveDate(parsed.clauses);
      const filingInputs: FilingInput[] = pending.map((p, i) => ({
        key: String(i),
        row: p.row,
        clauseId: p.clause ? idByIdx.get(p.clause.idx) : undefined,
        clauseNo: p.clause?.clause_no ?? null,
      }));
      const filed = await this.filing.fileDocument(docId, filingInputs, effectiveFrom);
      await push('filing', {
        state: 'done',
        effective_from: effectiveFrom,
        filed: filed.filed,
        new: filed.new,
        restatement: filed.restatement,
        amendment: filed.amendment,
        repeal: filed.repeal,
        ambiguous: filed.ambiguous,
        staged_versions: filed.amendment,
        review: filed.review.slice(0, 25),
      });

      // Only NEW rules become rows. A restatement adds provenance to the rule
      // that already exists; an amendment writes a PROPOSED version and leaves
      // the live one alone; an ambiguous filing commits nothing at all.
      const saved = await this.obligations.save(filed.insert, { chunk: 200 });
      const counts = {
        total: saved.length,
        active: saved.filter((o) => o.state === 'ACTIVE').length,
        review: saved.filter((o) => o.state === 'REVIEW').length,
      };
      await push('store_obligations', { state: 'done', ...counts });

      // ── Step 16: link resolution ────────────────────────────────────────
      // Runs HERE and not earlier because a link joins two RULES, and rules did
      // not exist until the line above. The citations themselves were extracted
      // at parse time, when the wording that produced the rules still existed.
      await push('links', { state: 'running' });
      const citationsByClauseIdx = new Map(
        parsed.clauses
          .filter((c) => (c.citations?.length ?? 0) > 0)
          .map((c) => [
            c.idx,
            (c.citations ?? []).map((k) => ({
              raw: k.raw,
              cue: k.cue,
              number: k.number,
              kind: k.kind,
              targetType: k.target_type,
              targetContainer: k.target_container,
              targetDoc: k.target_doc,
              rangeTo: k.range_to,
              charStart: k.char_start,
              charEnd: k.char_end,
              context: k.context,
            })),
          ]),
      );
      const links = await this.links.resolve(docId, { citationsByClauseIdx, idByIdx });
      await push('links', { state: 'done', ...links });

      // ── embeddings (obligations + normative clauses) ─────────────────────
      await push('embed', { state: 'running' });
      const embedStats = await this.embedAll(saved, docId, idByIdx, parsed.clauses);
      await push('embed', { state: 'done', ...embedStats });

      // ── Step 17: does the graph still agree with itself? ────────────────
      // Runs on the whole projection, not on this document: a contradiction is
      // a statement about a PAIR of rules, and the pair may span circulars. It
      // is also the pipeline's regression test — most findings trace back to a
      // mis-resolved audience or a wrongly merged fact, not to SEBI.
      await push('consistency', { state: 'running' });
      const report = await this.consistency.check();
      await push('consistency', {
        state: 'done',
        checked: report.checked.checked,
        live: report.checked.live,
        with_constraints: report.checked.withConstraints,
        not_fully_checked: report.skipped.noConstraints,
        ...report.counts,
        top_causes: report.byLikelyCause.slice(0, 3),
        samples: report.findings.slice(0, 10).map((f) => ({
          family: f.family,
          rules: f.rules,
          message: f.message.slice(0, 160),
        })),
      });

      await push('done', { drafter, obligations: counts, clauses: idByIdx.size }, 'completed');
      this.streamOf(runId).complete();
      this.streams.delete(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`run ${runId} failed: ${message}`);
      const run = await this.runs.findOneBy({ id: runId });
      if (run) {
        run.status = 'failed';
        run.error = message.slice(0, 2000);
        run.finishedAt = new Date();
        await this.runs.save(run);
      }
      this.streamOf(runId).next({ runId, status: 'failed', stage: 'error', detail: { message } });
      this.streamOf(runId).complete();
      this.streams.delete(runId);
    }
  }

  /**
   * M3 — run every drafted rule through the attribute funnel, then stamp the
   * canonical expression + fingerprints back onto the obligation row (before it is
   * saved, so what lands in the DB is already canonical).
   *
   * Embeddings are batched up front (one composite string per distinct token), but
   * the funnel itself walks rules sequentially: creating an attribute has to be
   * visible to the next token's vector search, otherwise the same data-point would
   * be created twice inside a single circular.
   */
  private async resolveAttributes(
    docId: string,
    pending: { row: Obligation; rule: AiRule; clause?: AiClause }[],
  ): Promise<Record<string, unknown>> {
    // 1. every distinct composite string, embedded in batches
    const seen = new Set<string>();
    const inputs: string[] = [];
    for (const p of pending) {
      const topic = p.rule.context || '';
      for (const [token, hint] of Object.entries(p.rule.attribute_hints || {})) {
        const composite = AttributeResolverService.composite(token, hint?.meaning || '', topic);
        if (!seen.has(composite)) {
          seen.add(composite);
          inputs.push(composite);
        }
      }
    }

    const vecByComposite = new Map<string, number[]>();
    let mock = false;
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      const batch = inputs.slice(i, i + EMBED_BATCH);
      const res = await this.ai.embed(batch);
      mock = res.mock;
      batch.forEach((composite, j) => vecByComposite.set(composite, res.embeddings[j]));
    }

    // 2. funnel each rule, in document order
    const memo = new Map<string, { id: number; category: string; canonicalName: string }>();
    const stats: ResolveStats = { tokens: 0, reused: 0, created: 0, judged: 0, tripwired: 0, typeGated: 0 };
    const refIdsByRow = new Map<number, Record<string, number>>();
    for (const [i, p] of pending.entries()) {
      const out = await this.resolver.resolve(docId, p.rule, p.clause, vecByComposite, memo, stats);
      p.row.attributeIds = out.attributeIds;
      p.row.ruleExpression = out.canonicalExpression;
      refIdsByRow.set(i, out.refIds);
    }

    // 3. Step 14 — fingerprints, in one batched call per document.
    //
    // This runs AFTER attribute resolution because identity is built from
    // registry ids, and AFTER the audience floor because the audience is part
    // of identity. Without it the QSB 180-day and non-QSB 90-day rules produce
    // the same identity hash and Step 15 treats one as an amendment of the
    // other. Decisions 74, 75.
    const fpStats = await this.fingerprintRules(docId, pending, refIdsByRow);

    return {
      ...stats,
      distinct_composites: inputs.length,
      embeddings_mock: mock,
      ...fpStats,
    };
  }

  /**
   * Step 14. The audience comes from the clause the rule was drafted from — the
   * floor Pattern C stamped, or a narrower one once D2 lands. A rule whose
   * clause has no audience gets `null`, which is deliberately NOT the same hash
   * as any real audience: an unassigned rule must not collide with an assigned
   * one.
   */
  private async fingerprintRules(
    docId: string,
    pending: { row: Obligation; rule: AiRule; clause?: AiClause }[],
    refIdsByRow: Map<number, Record<string, number>>,
  ): Promise<Record<string, unknown>> {
    const audienceByClauseNo = new Map<string, number>();
    const rows: { clause_no: string | null; audience_id: number | null }[] =
      await this.clauses.query(
        `SELECT clause_no, audience_id FROM source_clauses
          WHERE doc_id = $1 AND audience_id IS NOT NULL`,
        [docId],
      );
    for (const r of rows) {
      if (r.clause_no && r.audience_id != null) {
        audienceByClauseNo.set(r.clause_no, r.audience_id);
      }
    }

    const items = pending.map((p, i) => ({
      key: String(i),
      expression: p.row.ruleExpression || '',
      // Assembly's answer wins over the clause's. It is the same audience
      // unless a modifier narrowed it, and when one did, the narrowing is the
      // whole point — the clause audience is what the rule applied to BEFORE
      // Step 12 ran.
      audience_id:
        p.row.audienceId ??
        (p.clause?.clause_no ? (audienceByClauseNo.get(p.clause.clause_no) ?? null) : null),
      attribute_ids: refIdsByRow.get(i) || {},
      obligation_text: p.row.title || undefined,
    }));

    let structural = 0;
    let attestable = 0;
    for (let i = 0; i < items.length; i += FINGERPRINT_BATCH) {
      const batch = items.slice(i, i + FINGERPRINT_BATCH);
      const results = await this.ai.fingerprint(batch);
      for (const fp of results) {
        const row = pending[Number(fp.key)]?.row;
        if (!row) continue;
        row.identityHash = fp.identity_hash;
        row.fullHash = fp.full_hash;
        // MERGED, not replaced. Assembly wrote what it applied before this ran,
        // and assigning wholesale discarded it — found by a live check that
        // returned zero rows carrying `modified_by`.
        row.hashInputs = { ...fp.hash_inputs, ...(row.assemblyNote ?? {}) };
        const audienceId = fp.hash_inputs?.audience_id as number | null | undefined;
        // Left unset rather than nulled when there is no audience: an
        // unassigned rule must stay visibly unassigned.
        if (typeof audienceId === 'number') row.audienceId = audienceId;
        if (fp.structural) structural += 1;
        else attestable += 1;
      }
    }
    return { fingerprints: items.length, structural, attestable };
  }

  /**
   * Recall audit — the safety net for the blocklist filter. A clause that ended
   * with NO rule (the drafter declined it, or we skipped it as a non-TOC/-container
   * junk stub) but still contains numbers with teeth — durations, ₹ amounts,
   * percentages — is suspicious by construction: compliance rules are made of
   * numbers. Those get flagged for the review queue so nothing numeric vanishes
   * silently. (TOC/container junk is excluded — their numbers are page refs /
   * heading numbers, not obligations.)
   */
  private recallAudit(
    clauses: AiClause[],
    clauseByIdx: Map<number, AiClause>,
    declinedIdx: number[],
  ): { swept: number; flagged: { clause: string | null; page: number; teeth: string }[] } {
    const teeth =
      /(\b\d+(?:\.\d+)?\s*(?:day|days|month|months|year|years|hour|hours|week|weeks|working\s+day)\b)|(₹|\bRs\.?\s*\d)|(\b\d+(?:\.\d+)?\s*(?:lakh|crore|lakhs|crores)\b)|(\b\d+(?:\.\d+)?\s*%|\bper\s*cent\b|\bpercent\b)/i;

    const targets: AiClause[] = [];
    for (const idx of declinedIdx) {
      const c = clauseByIdx.get(idx);
      if (c) targets.push(c);
    }
    // non-TOC/-container junk we skipped without ever sending (rare — stubs)
    for (const c of clauses) {
      if (c.junk && c.kind !== 'toc' && c.kind !== 'container' && !c.window_text) targets.push(c);
    }

    const flagged: { clause: string | null; page: number; teeth: string }[] = [];
    for (const c of targets) {
      const m = teeth.exec(c.text || '');
      if (m) flagged.push({ clause: c.clause_no, page: c.page, teeth: m[0].trim() });
    }
    return { swept: targets.length, flagged };
  }

  /** Re-ingesting the same doc replaces its clauses + obligations. */
  private async deleteDocRows(docId: string) {
    await this.clauses.delete({ docId });
    await this.obligations
      .createQueryBuilder()
      .delete()
      .where(`source_spans @> :span::jsonb`, { span: JSON.stringify([{ doc_id: docId }]) })
      .execute();
  }

  /**
   * Step 10a. Resolves the document's base audience and stamps it on every
   * clause that has none, as a FLOOR — D2 later narrows the clauses a chapter
   * scopes more tightly, and `audience_source` records which pattern won.
   *
   * Returns null rather than guessing when nothing is named: a wrong floor puts
   * duties on firms that do not owe them, while no floor leaves the clauses
   * visibly unassigned, which a person can see and fix.
   */
  /**
   * The date the circular takes effect — the replay sort key.
   *
   * Step 16 will parse it properly from the document header. Until then the
   * filing date on the preamble is the best available signal, and the ingestion
   * date is the fallback. Getting this wrong reorders history, so it is
   * deliberately visible in the SSE stream rather than buried.
   */
  private effectiveDate(aiClauses: AiClause[]): string {
    const preamble = aiClauses.find((c) => c.is_title) ?? aiClauses[0];
    const text = preamble?.text ?? '';
    const match = text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
    );
    if (match) {
      const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
      const day = String(Number(match[2])).padStart(2, '0');
      return `${match[3]}-${String(month).padStart(2, '0')}-${day}`;
    }
    return new Date().toISOString().slice(0, 10);
  }

  private async stampDocumentAudience(
    docId: string,
    aiClauses: AiClause[],
  ): Promise<Record<string, unknown> | null> {
    const titleClause = aiClauses.find((c) => c.is_title);
    const opening: string[] = [];
    if (titleClause?.text) opening.push(titleClause.text.replace(/\s+/g, ' ').trim());
    for (const c of aiClauses) {
      if (c.kind !== 'clause' || !c.window_text || !c.text?.trim()) continue;
      opening.push(`${c.clause_no ?? ''} ${c.text.replace(/\s+/g, ' ')}`.trim());
      if (opening.length > PATTERN_C_OPENING_CLAUSES) break;
    }

    const resolution = await this.audienceResolver.resolveDocument(
      docId,
      titleClause?.title_text ?? null,
      opening,
    );
    if (!resolution) return null;

    const stamped = await this.clauses.query(
      `UPDATE source_clauses SET audience_id = $1, audience_source = 'C'
       WHERE doc_id = $2 AND audience_id IS NULL`,
      [resolution.audience.id, docId],
    );

    return {
      resolved: true,
      audienceId: resolution.audience.id,
      label: resolution.audience.label,
      predicate: resolution.audience.predicate,
      // Pattern A composes against these, so the floor's CONDITIONS travel with
      // it, not just its rendered predicate. Re-parsing the string in the
      // backend would be a second parser to keep in step with Python's.
      conditions: resolution.ai.conditions,
      rung: resolution.rung,
      needsApproval: resolution.needsApproval,
      // TypeORM's raw query returns [rows, rowCount] for an UPDATE. Taking
      // .length here reports 2 for every document, which is how this was wrong
      // the first time.
      clausesStamped: Array.isArray(stamped) ? Number(stamped[1]) : undefined,
    };
  }

  /**
   * Step 10b — classify every heading, resolve each through the ladder, and let
   * the tree inherit.
   *
   * Walked by DEPTH, one batched call per level. A child heading has to be
   * composed against its parent's RESOLVED audience, so "18.5 ... for QSBs"
   * cannot be classified while the pipeline still believes its parent is "all
   * stock brokers". Depth is small — five or six levels — so this is five or six
   * round trips, not one per heading.
   */
  private async stampChapterAudiences(
    docId: string,
    aiClauses: AiClause[],
    idByIdx: Map<number, number>,
    floor: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const nodes: HeadingClause[] = aiClauses.map((c) => ({
      idx: c.idx,
      parentIdx: c.parent_idx,
      depth: c.depth,
      heading: c.heading,
      clauseNo: c.clause_no,
      text: c.text,
    }));

    const floorConditions = (floor?.conditions as string[] | undefined) ?? [];
    const floorPredicate = (floor?.predicate as string | undefined) ?? null;

    // idx -> the audience resolved AT that heading, and the conditions in force.
    const audienceAt = new Map<number, number>();
    const conditionsAt = new Map<number, string[]>();
    const predicateAt = new Map<number, string>();

    let headingsSent = 0;
    let audiencesFound = 0;
    let created = 0;
    let reused = 0;
    const refused: { heading: string; error: string }[] = [];
    const pending: { label: string; predicate: string; confidence: number }[] = [];
    const narrower = new Set<string>();

    for (const level of headingLevels(nodes)) {
      const batch: AiHeadingIn[] = level.map((h) => {
        const parentIdx = nearestResolved(h.idx, nodes, conditionsAt);
        return {
          idx: h.idx,
          heading: h.heading,
          ancestry: h.ancestry,
          opening: h.opening,
          parent_predicate: parentIdx === null ? floorPredicate : (predicateAt.get(parentIdx) ?? null),
          parent_conditions: parentIdx === null ? floorConditions : (conditionsAt.get(parentIdx) ?? []),
        };
      });
      headingsSent += batch.length;
      const { results } = await this.ai.headingAudiences(docId, batch);

      for (const r of results) {
        if (r.is_audience && !r.resolved) {
          // The heading names a firm type its parent excludes. Refused, not
          // filed: a contradictory audience matches no firm at all, so every
          // rule beneath it would be addressed to nobody. It is also a signal
          // that the DOCUMENT FLOOR may be too narrow — worth a human, not a
          // silent widening, because too broad puts duties on firms that do
          // not owe them and nothing downstream can detect that.
          refused.push({ heading: r.heading.slice(0, 80), error: r.error ?? 'unresolved' });
          continue;
        }
        if (!r.resolved || !r.predicate_hash) continue;

        const parentIdx = nearestResolved(r.idx, nodes, conditionsAt);
        const inForce = parentIdx === null ? floorConditions : (conditionsAt.get(parentIdx) ?? []);
        // A heading that composes to exactly what is already in force is a
        // topic dressed as an audience ("Registration of Brokers" inside a
        // broker circular). It narrows nothing, so it stamps nothing.
        if (r.conditions.length === inForce.length &&
            r.conditions.every((c, i) => c === inForce[i])) {
          continue;
        }

        audiencesFound += 1;
        const resolution = await this.audienceResolver.resolve({
          label: r.label || r.heading.slice(0, 80),
          predicate: r.normalised,
          predicateHash: r.predicate_hash,
          conditions: r.conditions,
          properties: r.conditions.map((c) => c.split(' ')[0]),
          confidence: r.confidence,
          pattern: 'A',
          createdFrom: docId,
        });
        if (resolution.rung === 'created') created += 1;
        else reused += 1;
        if (resolution.needsApproval) {
          pending.push({
            label: resolution.audience.label,
            predicate: resolution.audience.predicate,
            confidence: resolution.confidence,
          });
        }
        audienceAt.set(r.idx, resolution.audience.id);
        conditionsAt.set(r.idx, r.conditions);
        predicateAt.set(r.idx, r.normalised);
        narrower.add(r.normalised);
      }
    }

    if (audienceAt.size === 0) {
      return { headings: headingsSent, audiences: 0, refused: refused.length, samples: refused.slice(0, 10) };
    }

    // ── 10f — stamp the tree ────────────────────────────────────────────────
    // Every descendant with no audience heading of its own inherits. This is
    // why the step is cheap: one heading call covers hundreds of clauses.
    const perClause = stampTree(nodes, audienceAt);
    const byAudience = new Map<number, number[]>();
    for (const [idx, audienceId] of perClause) {
      const rowId = idByIdx.get(idx);
      if (rowId === undefined) continue;
      const list = byAudience.get(audienceId) ?? [];
      list.push(rowId);
      byAudience.set(audienceId, list);
    }
    let stamped = 0;
    for (const [audienceId, rowIds] of byAudience) {
      const res = await this.clauses.query(
        `UPDATE source_clauses SET audience_id = $1, audience_source = 'A'
          WHERE id = ANY($2::int[])`,
        [audienceId, rowIds],
      );
      stamped += Array.isArray(res) ? Number(res[1]) : 0;
    }

    return {
      headings: headingsSent,
      audiences: audiencesFound,
      created,
      reused,
      refused: refused.length,
      distinct: narrower.size,
      clauses_stamped: stamped,
      narrower: [...narrower].slice(0, 10),
      needs_approval: pending.slice(0, 10),
      samples: refused.slice(0, 10),
    };
  }

  /**
   * Write assembly's answers onto the rows, BEFORE they are fingerprinted.
   *
   * Three things land here and the order they were computed in is the design's:
   * modifiers applied, preconditions attached, audience settled. A rule whose
   * applicability stopped being a plain conjunction keeps its audience id but
   * carries the expression in `context`, because an identity hash built from a
   * conjunction that is not the rule's actual applicability would be a hash of
   * something untrue.
   */
  private async applyAssembly(
    docId: string,
    pending: { row: Obligation; rule: AiRule; clause?: AiClause }[],
    assembled: Awaited<ReturnType<AssemblyService['assembleDocument']>>,
  ): Promise<{ narrowed: number; audiences: number[] }> {
    const byKey = new Map(assembled.rules.map((r) => [r.key, r]));
    // One composed test is resolved ONCE, however many rules share it.
    const audienceByPredicate = new Map<string, number>();
    let narrowed = 0;

    for (let i = 0; i < pending.length; i += 1) {
      const p = pending[i];
      const result = byKey.get(String(i));
      if (!result) continue;
      if (result.appliedFrom.length === 0 && result.preconditions.length === 0) continue;

      // Kept in `assemblyInputs` and merged into `hashInputs` AFTER
      // fingerprinting, because the fingerprint response replaces hashInputs
      // wholesale — writing it here first meant it was silently discarded.
      p.row.assemblyNote = {
        applicability: assembled.rendered.get(result.key),
        modified_by: result.appliedFrom,
        preconditions: result.preconditions,
      };

      // ⚠️ THE NARROWED AUDIENCE MUST REACH THE FINGERPRINT.
      //
      // Recording the narrowing in hash_inputs and leaving audience_id pointing
      // at the CLAUSE's audience would mean the restriction was documented and
      // not applied: the rule would fingerprint, file and evaluate as though it
      // still reached every firm in the chapter. Which is the exact failure
      // Step 12 exists to prevent.
      // Only when the audience ACTUALLY moved. A rule that picked up a
      // precondition and nothing else keeps the audience Step 10 gave it;
      // resolving it again would mint a duplicate of the same test and report
      // three narrowings where none happened.
      const moved =
        result.conditions !== null &&
        result.conditions.join(' && ') !== [...result.baseConditions].sort().join(' && ');
      if (moved && result.conditions) {
        const key = result.conditions.join(' && ');
        let audienceId = audienceByPredicate.get(key);
        if (audienceId === undefined) {
          const composed = await this.ai.composeAudience([], key);
          if (composed.ok && composed.predicate_hash) {
            const resolution = await this.audienceResolver.resolve({
              label: `${p.row.title.slice(0, 50)} (as modified)`,
              predicate: composed.normalised,
              predicateHash: composed.predicate_hash,
              conditions: composed.conditions,
              properties: composed.conditions.map((c) => c.split(' ')[0]),
              // A modifier-narrowed audience is never auto-approved: it exists
              // because a machine read one sentence about another clause.
              confidence: 0.4,
              pattern: 'A',
              createdFrom: docId,
            });
            audienceId = resolution.audience.id;
            audienceByPredicate.set(key, audienceId);
          }
        }
        if (audienceId !== undefined) {
          p.row.audienceId = audienceId;
          narrowed += 1;
        }
      }

      // Problem 2 — a restriction we cannot express must not be filed as though
      // it did not exist. Filing unrestricted applies the rule to firms it
      // should not reach; dropping it makes firms miss a duty they owe. REVIEW
      // is the only choice that is not silently wrong in one direction.
      if (result.needsReview) p.row.state = 'REVIEW';
    }
    return { narrowed, audiences: [...audienceByPredicate.values()] };
  }

  /**
   * Step 13d — a precondition IS an audience test, so it takes the audience path.
   *
   * "where the broker holds client funds..." narrows who the rule reaches, not
   * what it checks. Burying it in the expression would make it invisible to the
   * lattice, to Step 17's overlap check, and to the firm asking why a rule
   * applies to them.
   *
   * Runs BEFORE fingerprinting, for the same reason assembly does: the audience
   * is part of identity, and narrowing it afterwards is a phantom amendment.
   */
  private async promotePreconditions(
    docId: string,
    pending: { row: Obligation; rule: AiRule; clause?: AiClause }[],
  ): Promise<Record<string, number>> {
    const withPrecondition = pending.filter((p) => (p.rule.precondition || '').trim());
    if (withPrecondition.length === 0) {
      return { rules: 0, promoted: 0, unexpressible: 0, reused: 0, created: 0 };
    }

    const clauseAudiences = new Map<string, { id: number; conditions: string[] }>();
    const rows: { clause_no: string | null; audience_id: number | null; predicate: string | null }[] =
      await this.clauses.query(
        `SELECT c.clause_no, c.audience_id, a.predicate
           FROM source_clauses c LEFT JOIN audiences a ON a.id = c.audience_id
          WHERE c.doc_id = $1 AND c.audience_id IS NOT NULL`,
        [docId],
      );
    for (const r of rows) {
      if (r.clause_no) {
        clauseAudiences.set(r.clause_no, {
          id: r.audience_id as number,
          conditions: conditionsOf(r.predicate ?? ''),
        });
      }
    }

    // One composed test is resolved once, however many rules share it.
    const byPredicate = new Map<string, number | null>();
    let promotedCount = 0;
    let unexpressible = 0;
    let reused = 0;
    let created = 0;

    for (const p of withPrecondition) {
      const precondition = (p.rule.precondition || '').trim();
      const base = p.clause?.clause_no ? clauseAudiences.get(p.clause.clause_no) : undefined;
      const key = `${base?.conditions.join(' && ') ?? ''}|${precondition}`;
      if (!byPredicate.has(key)) {
        const composed = await this.ai.composeAudience(base?.conditions ?? [], precondition);
        if (!composed.ok || !composed.predicate_hash) {
          // Not expressible in the firm vocabulary. The rule is NOT filed as
          // though the precondition did not exist — that would apply it to
          // firms it should never reach.
          byPredicate.set(key, null);
        } else {
          const before = (await this.audienceResolver.dbStore().findByHash(composed.predicate_hash)) !== null;
          const resolution = await this.audienceResolver.resolve({
            label: `${p.row.title.slice(0, 44)} (precondition)`,
            predicate: composed.normalised,
            predicateHash: composed.predicate_hash,
            conditions: composed.conditions,
            properties: composed.conditions.map((c) => c.split(' ')[0]),
            confidence: p.rule.confidence ?? 0.4,
            pattern: 'A',
            createdFrom: docId,
          });
          if (before) reused += 1;
          else created += 1;
          byPredicate.set(key, resolution.audience.id);
        }
      }

      const audienceId = byPredicate.get(key) ?? null;
      if (audienceId === null) {
        unexpressible += 1;
        p.row.state = 'REVIEW';
        p.row.assemblyNote = {
          ...(p.row.assemblyNote ?? {}),
          pending_precondition: precondition,
        };
        continue;
      }
      p.row.audienceId = audienceId;
      promotedCount += 1;
      // DROPPED once promoted — it is now redundant, and a precondition left
      // attached beside the audience it became would be checked twice.
      p.row.assemblyNote = {
        ...(p.row.assemblyNote ?? {}),
        promoted_precondition: precondition,
      };
    }

    return {
      rules: withPrecondition.length,
      promoted: promotedCount,
      unexpressible,
      reused,
      created,
    };
  }

  private async storeClauses(docId: string, aiClauses: AiClause[]): Promise<Map<number, number>> {
    // phase 1: bulk insert without parent links, collect db ids by ai idx
    const idByIdx = new Map<number, number>();
    for (let i = 0; i < aiClauses.length; i += 500) {
      const slice = aiClauses.slice(i, i + 500);
      const saved = await this.clauses.save(
        slice.map((c) =>
          this.clauses.create({
            docId,
            clauseNo: c.clause_no ?? undefined,
            heading: c.heading ?? undefined,
            page: c.page,
            charStart: c.char_start,
            charEnd: c.char_end,
            text: this.renderClauseText(c),
            isTitle: c.is_title ?? false,
            titleText: c.title_text ?? undefined,
          }),
        ),
      );
      saved.forEach((row, j) => idByIdx.set(slice[j].idx, row.id));
    }

    // phase 2: one bulk UPDATE for all parent links (same-batch parents included)
    const linked = aiClauses.filter(
      (c) => c.parent_idx != null && idByIdx.has(c.parent_idx) && idByIdx.has(c.idx),
    );
    if (linked.length) {
      await this.clauses.query(
        `UPDATE source_clauses SET parent_id = m.pid
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS pid) m
         WHERE source_clauses.id = m.id`,
        [
          linked.map((c) => idByIdx.get(c.idx)),
          linked.map((c) => idByIdx.get(c.parent_idx as number)),
        ],
      );
    }
    return idByIdx;
  }

  /** Stored text keeps kind/leaf markers out; heading folds in for display. */
  private renderClauseText(c: AiClause): string {
    return c.heading && c.text ? `${c.heading}\n${c.text}` : c.heading || c.text;
  }

  private toObligation(docId: string, rule: AiRule, clause?: AiClause): Obligation {
    const astValid = rule.ast?.valid === true;
    const state: GovernanceState =
      astValid && rule.confidence >= CONFIDENCE_ACTIVE ? 'ACTIVE' : 'REVIEW';
    return this.obligations.create({
      title: rule.title || `Obligation from clause ${rule.source_clause}`,
      ruleExpression: rule.rule_expression,
      resultPass: rule.result_pass,
      resultFail: rule.result_fail,
      attributeIds: [], // filled by the M3 funnel in resolveAttributes(), before save
      obligationType: (rule.obligation_type === 'attestable'
        ? 'attestable'
        : 'computable') as ObligationType,
      context: rule.context,
      sourceSpans: [
        {
          doc_id: docId,
          clause: rule.source_clause || clause?.clause_no || '',
          page: clause?.page ?? 0,
          char: [clause?.char_start ?? 0, clause?.char_end ?? 0],
        },
      ],
      version: 1,
      state,
      confidence: rule.confidence,
    });
  }

  private async embedAll(
    saved: Obligation[],
    docId: string,
    idByIdx: Map<number, number>,
    aiClauses: AiClause[],
  ): Promise<Record<string, unknown>> {
    let mock = false;

    // obligations: title + expression + context is the matching surface (M6)
    for (let i = 0; i < saved.length; i += EMBED_BATCH) {
      const batch = saved.slice(i, i + EMBED_BATCH);
      const res = await this.ai.embed(
        batch.map((o) => `${o.title}\n${o.ruleExpression}\ncontext: ${o.context}`),
      );
      mock = res.mock;
      await Promise.all(
        batch.map((o, j) =>
          this.obligations.query(
            'UPDATE obligations SET embedding = $1::vector WHERE id = $2',
            [JSON.stringify(res.embeddings[j]), o.id],
          ),
        ),
      );
    }

    // normative clauses: retrieval surface for amendment matching lanes (M6)
    const normative = aiClauses.filter((c) => c.normative && idByIdx.has(c.idx));
    for (let i = 0; i < normative.length; i += EMBED_BATCH) {
      const batch = normative.slice(i, i + EMBED_BATCH);
      const res = await this.ai.embed(batch.map((c) => `${c.path}\n${c.text}`.slice(0, 6000)));
      mock = res.mock;
      await Promise.all(
        batch.map((c, j) =>
          this.clauses.query(
            'UPDATE source_clauses SET embedding = $1::vector WHERE id = $2',
            [JSON.stringify(res.embeddings[j]), idByIdx.get(c.idx)],
          ),
        ),
      );
    }

    return { obligations: saved.length, clauses: normative.length, mock };
  }
}
