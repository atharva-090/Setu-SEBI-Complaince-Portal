import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, concat, defer, from, map } from 'rxjs';
import { Repository } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { Obligation } from '../database/entities/obligation.entity';
import { SourceClause } from '../database/entities/source-clause.entity';
import { ConsistencyService } from './consistency.service';
import { IngestionService } from './ingestion.service';
import { MongoService } from './mongo.service';

const MAX_PDF_BYTES = 60 * 1024 * 1024;

@ApiTags('ingestion')
@ApiBearerAuth()
@Controller()
export class CircularsController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly consistency: ConsistencyService,
    private readonly mongo: MongoService,
    @InjectRepository(SourceClause) private readonly clauses: Repository<SourceClause>,
    @InjectRepository(Obligation) private readonly obligations: Repository<Obligation>,
  ) {}

  /**
   * Step 17 — does the graph agree with itself?
   *
   * Deliberately a whole-graph endpoint rather than a per-document one: every
   * finding is a statement about a PAIR of rules, so it can only be asked of the
   * projection. Reports, never fixes.
   */
  @Get('consistency')
  @Roles('sebi_admin')
  async consistencyReport() {
    return this.consistency.check();
  }

  /**
   * Step 10e — the approval queue.
   *
   * Creating an audience is the one deliberate interruption in the pipeline.
   * The queue is ordered by how much of the graph each proposal would move:
   * approving one that scopes 68 clauses matters more than one scoping 1, and
   * a reviewer with limited attention should spend it there.
   */
  @Get('audiences')
  @Roles('sebi_admin')
  async audienceQueue(@Query('state') state?: string) {
    const rows = await this.obligations.query(
      `SELECT a.id, a.label, a.predicate, a.pattern, a.state, a.confidence,
              a.created_from, a.aliases,
              (SELECT count(*)::int FROM source_clauses c WHERE c.audience_id = a.id) AS clauses,
              (SELECT count(*)::int FROM obligations o WHERE o.audience_id = a.id) AS rules,
              (SELECT array_agg(b.predicate) FROM audience_edges e
                 JOIN audiences b ON b.id = e.broader_id
                WHERE e.narrower_id = a.id) AS broader
         FROM audiences a
        WHERE ($1::text IS NULL OR a.state = $1::text)
        ORDER BY (a.state = 'PROPOSED') DESC, clauses DESC, a.id`,
      [state ?? null],
    );
    return {
      proposed: rows.filter((r: { state: string }) => r.state === 'PROPOSED').length,
      approved: rows.filter((r: { state: string }) => r.state === 'APPROVED').length,
      audiences: rows,
    };
  }

  /**
   * Approve one proposed audience.
   *
   * There is deliberately no bulk approve-all. The gate exists because a
   * wrongly created audience splits one group into two branches that both look
   * valid forever after; a button that waves through everything at once is the
   * gate not existing.
   */
  @Post('audiences/:id/approve')
  @Roles('sebi_admin')
  async approveAudience(@Param('id') id: string, @Req() req: { user?: { email?: string } }) {
    const audienceId = Number(id);
    if (!Number.isInteger(audienceId)) throw new BadRequestException('bad audience id');
    const res = await this.obligations.query(
      `UPDATE audiences SET state = 'APPROVED', approved_by = $2, approved_at = now()
        WHERE id = $1 AND state = 'PROPOSED'
        RETURNING id, label, predicate, state`,
      [audienceId, req.user?.email ?? 'sebi_admin'],
    );
    // TypeORM's raw query returns [rows, rowCount] for an UPDATE ... RETURNING.
    // `res[0] ?? res` would be an EMPTY ARRAY when nothing matched — truthy, and
    // a second approval would silently answer 200 with [].
    const rows: unknown[] = Array.isArray(res?.[0]) ? res[0] : Array.isArray(res) ? res : [];
    const row = rows[0];
    if (!row) throw new NotFoundException('no such audience, or it is already approved');
    return row;
  }

  /**
   * Step 16 — the linked graph, and what is still waiting.
   *
   * The parked queue is shown alongside the edges on purpose. A link report that
   * listed only the edges it MADE would read as complete while a queue of
   * citations sat unresolved behind it, and "who is still waiting for a document
   * we have not ingested" is the more useful half for a regulator.
   */
  @Get('links')
  @Roles('sebi_admin')
  async linkReport() {
    const edges = await this.obligations.query(
      `SELECT type, state, count(*)::int AS n FROM edges GROUP BY type, state ORDER BY n DESC`,
    );
    const pending = await this.obligations.query(
      `SELECT state, count(*)::int AS n FROM unresolved_citations GROUP BY state`,
    );
    const waiting = await this.obligations.query(
      `SELECT target_doc, target_container, target_clause_no, count(*)::int AS n
         FROM unresolved_citations WHERE state = 'PENDING'
        GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 25`,
    );
    const samples = await this.obligations.query(
      `SELECT e.id, e.from_id, e.to_id, e.type, e.state, e.confidence,
              e.source_citation ->> 'raw' AS citation,
              e.source_citation ->> 'resolved_by' AS resolved_by
         FROM edges e WHERE e.type = 'depends_on' ORDER BY e.id DESC LIMIT 10`,
    );
    return { edges, citations: pending, waiting, samples };
  }

  /** SEBI admin uploads a circular PDF → file lands in GridFS, pipeline starts. */
  @Post('circulars')
  @Roles('sebi_admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        docId: { type: 'string', description: 'optional; defaults to slug of filename' },
      },
      required: ['file'],
    },
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('docId') docIdRaw?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    if (!file.buffer.subarray(0, 5).toString('latin1').startsWith('%PDF'))
      throw new BadRequestException('not a PDF');

    const docId = (docIdRaw?.trim() || file.originalname.replace(/\.pdf$/i, ''))
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 120);

    const fileRef = await this.mongo.storePdf(file.originalname, file.buffer, { docId });
    const run = await this.ingestion.createRun(docId);

    // synchronous pipeline, async kickoff — progress flows via run row + SSE
    void this.ingestion.orchestrate(run.id, docId, fileRef, file.originalname);

    return { runId: run.id, docId, fileRef, stream: `/api/v1/ingestion/${run.id}/stream` };
  }

  @Get('ingestion/:id')
  @Roles('sebi_admin')
  async getRun(@Param('id') id: string) {
    const run = await this.ingestion.getRun(id);
    if (!run) throw new NotFoundException(`no ingestion run ${id}`);
    return run;
  }

  /**
   * Live pipeline progress for the console. EventSource cannot send an
   * Authorization header, so this route is public — the unguessable run UUID
   * is the capability (hackathon tradeoff, progress metadata only).
   */
  @Public()
  @Sse('ingestion/:id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    const snapshot = defer(() => from(this.ingestion.getRun(id))).pipe(
      map((run) => ({
        runId: id,
        status: run?.status ?? 'unknown',
        stage: 'snapshot',
        detail: (run?.stages ?? {}) as Record<string, unknown>,
      })),
    );
    return concat(snapshot, this.ingestion.streamOf(id)).pipe(
      map((event) => ({ data: event }) as MessageEvent),
    );
  }

  /** Parsed clause tree for a document (Clause Inspector / verification). */
  @Get('circulars/:docId/clauses')
  async clausesOf(@Param('docId') docId: string) {
    return this.clauses.find({
      where: { docId },
      order: { id: 'ASC' },
      select: ['id', 'clauseNo', 'heading', 'parentId', 'page', 'charStart', 'charEnd', 'text'],
    });
  }

  /** Obligations extracted from a document. */
  @Get('circulars/:docId/obligations')
  async obligationsOf(@Param('docId') docId: string) {
    return this.obligations
      .createQueryBuilder('o')
      .where('o.source_spans @> :span::jsonb', { span: JSON.stringify([{ doc_id: docId }]) })
      .orderBy('o.id', 'ASC')
      .getMany();
  }
}
