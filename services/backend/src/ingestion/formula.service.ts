import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../database/entities/attribute.entity';
import { Formula } from '../database/entities/formula.entity';
import { AiClientService } from './ai-client.service';

/**
 * The closed data-type vocabulary, and what a model actually returns.
 *
 * The tool schema constrains this to five values and gpt-4o still answered
 * "numeric" for every input of the net-worth definition. A schema is a request,
 * not a guarantee, so the boundary normalises rather than trusting -- storing
 * "numeric" would give the type gate a value it has never heard of, and a type
 * it cannot compare is a type that silently blocks every merge.
 */
const DATA_TYPES = new Set(['date', 'number', 'boolean', 'string', 'document']);
const DATA_TYPE_ALIASES: Record<string, string> = {
  numeric: 'number', integer: 'number', int: 'number', float: 'number',
  decimal: 'number', currency: 'number', amount: 'number', percentage: 'number',
  datetime: 'date', timestamp: 'date', bool: 'boolean', text: 'string',
  file: 'document', doc: 'document', attachment: 'document',
};

export function normaliseDataType(raw: string | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (DATA_TYPES.has(value)) return value;
  return DATA_TYPE_ALIASES[value] ?? 'string';
}

export interface DraftedDefinition {
  term: string;
  expression?: string;
  meaning: string;
  inputs?: Record<string, { data_type?: string; meaning?: string; unit?: string }>;
  confidence?: number;
  clauseNo?: string | null;
}

/**
 * Step 13a — definitions resolve FIRST.
 *
 * Not "first" as a matter of tidiness. If a rule using `net_worth` resolved
 * before the definition did, the funnel would meet the token cold and create it
 * as an ordinary attribute — and the intake form would then **ask the broker for
 * their net worth** instead of computing it from paid-up capital and reserves
 * they have already supplied. Running definitions ahead of every rule makes that
 * outcome impossible rather than unlikely.
 *
 * `is_derived` is the flag that carries the consequence: the intake form only
 * ever asks for the LEAVES of the formula tree.
 */
@Injectable()
export class FormulaService {
  private readonly log = new Logger('Formulas');

  constructor(
    @InjectRepository(Attribute) private readonly attrs: Repository<Attribute>,
    @InjectRepository(Formula) private readonly formulas: Repository<Formula>,
    private readonly ai: AiClientService,
  ) {}

  /**
   * Register every definition this document states.
   *
   * Returns the derived attribute ids so the caller can see what the intake form
   * will now compute rather than ask for.
   */
  async register(
    docId: string,
    definitions: DraftedDefinition[],
  ): Promise<Record<string, unknown>> {
    if (definitions.length === 0) {
      return { definitions: 0, derived: 0, inputs: 0, amended: 0 };
    }

    let derived = 0;
    let inputsCreated = 0;
    let amended = 0;
    const samples: string[] = [];

    for (const def of definitions) {
      const term = (def.term || '').trim();
      if (!term) continue;

      const termAttr = await this.upsertAttribute(docId, term, def.meaning, 'number', def.clauseNo);

      // Every input becomes an ordinary attribute — these are the leaves, the
      // things a firm actually supplies.
      const inputIds: number[] = [];
      for (const [name, hint] of Object.entries(def.inputs ?? {})) {
        const before = await this.attrs.findOneBy({ canonicalName: name });
        const attr = await this.upsertAttribute(
          docId, name, hint?.meaning ?? '', normaliseDataType(hint?.data_type), def.clauseNo, hint?.unit,
        );
        if (!before) inputsCreated += 1;
        inputIds.push(attr.id);
      }

      // A term defined with no calculation is still worth registering: it stops
      // the same concept being invented twice under different names. But it is
      // NOT derived — nothing computes it, so the firm still supplies it.
      const expression = (def.expression || '').trim();
      if (!expression) continue;

      const existing = await this.formulas.findOneBy({ attributeId: termAttr.id });
      if (existing && existing.expression !== expression) {
        // Two circulars defining the same term differently is an AMENDMENT to
        // the definition, not a second definition. Recorded as a change needing
        // review rather than silently overwritten — a formula that changes under
        // a firm's feet changes every rule that reads it.
        existing.state = 'REVIEW';
        existing.expression = expression;
        existing.inputIds = inputIds;
        existing.sourceDoc = docId;
        existing.sourceClause = def.clauseNo ?? (undefined as unknown as string);
        await this.formulas.save(existing);
        amended += 1;
        this.log.warn(
          `definition of "${term}" changed by ${docId} — every rule reading it is affected`,
        );
        continue;
      }
      if (existing) continue;

      await this.formulas.save(
        this.formulas.create({
          attributeId: termAttr.id,
          expression,
          inputIds,
          sourceDoc: docId,
          sourceClause: def.clauseNo ?? undefined,
          confidence: def.confidence ?? 0.5,
          state: 'REVIEW',
        }),
      );
      await this.attrs.query(`UPDATE attributes SET is_derived = true WHERE id = $1`, [
        termAttr.id,
      ]);
      derived += 1;
      if (samples.length < 8) samples.push(`${term} = ${expression.slice(0, 60)}`);
    }

    this.log.log(
      `${docId}: ${definitions.length} definitions → ${derived} derived attributes, ` +
        `${inputsCreated} new inputs, ${amended} definitions amended`,
    );
    return { definitions: definitions.length, derived, inputs: inputsCreated, amended, samples };
  }

  /**
   * Find or create the attribute for a term.
   *
   * Deliberately NOT the full Step 13 funnel. A definition names its term
   * explicitly, so there is nothing to guess: an exact name or alias match is
   * the whole question, and putting a definition through meaning-similarity
   * would let it merge into a neighbouring concept.
   */
  private async upsertAttribute(
    docId: string,
    name: string,
    meaning: string,
    dataType: string,
    clauseNo?: string | null,
    unit?: string,
  ): Promise<Attribute> {
    const rows: { id: number }[] = await this.attrs.query(
      `SELECT id FROM attributes WHERE canonical_name = $1 OR $1 = ANY(aliases) LIMIT 1`,
      [name],
    );
    if (rows.length) return { id: rows[0].id } as Attribute;

    const created = await this.attrs.save(
      this.attrs.create({
        category: 'definition',
        canonicalName: name,
        dataType: normaliseDataType(dataType) as Attribute['dataType'],
        unit,
        description: meaning || name.replace(/_/g, ' '),
        aliases: [],
        createdFrom: `${docId}${clauseNo ? `#${clauseNo}` : ''}`,
      }),
    );

    try {
      const { embeddings } = await this.ai.embed([`name: ${name}. meaning: ${meaning}`]);
      if (embeddings[0]) {
        await this.attrs.query(`UPDATE attributes SET embedding = $2::vector WHERE id = $1`, [
          created.id,
          JSON.stringify(embeddings[0]),
        ]);
      }
    } catch (err) {
      // A missing embedding degrades later matching for this row and nothing
      // else. Losing the attribute would be worse.
      this.log.warn(`definition attribute ${created.id} not embedded: ${(err as Error).message}`);
    }
    return created;
  }
}
