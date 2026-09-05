import { Injectable, Logger } from '@nestjs/common';

/** Wire types for the AI-service contracts (services/ai-service/app/schemas.py). */
/** One reference string the parser found (Step 16 extraction, citations.py).
 *  Snake-cased because it crosses the wire exactly as the AI service emits it. */
export interface AiCitation {
  raw: string;
  cue: string;
  number: string;
  kind: 'definitional' | 'exemption' | 'amends' | 'supersedes' | 'trigger' | 'reference';
  target_type: 'internal' | 'statute' | 'annexure';
  target_container: string | null;
  target_doc: string | null;
  range_to: string | null;
  char_start: number;
  char_end: number;
  context: string;
}

export interface AiHeadingIn {
  idx: number;
  heading: string;
  ancestry: string[];
  opening: string;
  parent_predicate: string | null;
  parent_conditions: string[];
}

export interface AiHeadingAudience {
  idx: number;
  heading: string;
  is_audience: boolean;
  resolved: boolean;
  label: string | null;
  condition: string | null;
  relation: string | null;
  normalised: string;
  conditions: string[];
  predicate_hash: string | null;
  confidence: number;
  why: string | null;
  new_property: string | null;
  error: string | null;
}

export interface AiClause {
  idx: number;
  kind: string; // container | clause | preamble | toc
  clause_no: string | null;
  heading: string | null;
  parent_idx: number | null;
  page: number;
  depth: number;
  char_start: number;
  char_end: number;
  text: string;
  is_leaf: boolean;
  normative: boolean; // keyword-signal tag (UI/ordering), not the send gate
  is_title?: boolean; // carries the document subject line (task B2)
  title_text?: string | null; // "Master Circular for Stock Brokers" — Pattern C's input
  junk: boolean; // provable junk → not sent to the drafter
  path: string;
  window_text: string | null; // set for every clause we send (i.e. not junk)
  citations?: AiCitation[]; // Step 16 — parked at parse, resolved after filing
}

export interface AiNumberingAudit {
  checked: number;
  gaps_found: number;
  repaired: number;
  flagged: number;
  anomalies: { number: string; kind: string; resolution: string; page: number | null; parent: string }[];
}

export interface AiParseResponse {
  doc_id: string;
  pages: number;
  clauses: AiClause[];
  stats: Record<string, number>;
  audit: AiNumberingAudit;
}

export interface AiAudience {
  doc_id: string;
  resolved: boolean;
  entities: string[];
  predicate: string;
  /** The predicate after implied terms are added and conditions sorted. */
  normalised: string;
  conditions: string[];
  predicate_hash: string | null;
  label: string;
  confidence: number;
  evidence: string;
  provider: string;
  error: string | null;
}

export interface AiFingerprintItem {
  key: string;
  expression: string;
  audience_id: number | null;
  /** canonical ref name -> registry id, e.g. "Cyber.last_audit_date" -> 4471 */
  attribute_ids: Record<string, number>;
  obligation_text?: string;
}

export interface AiFingerprint {
  key: string;
  /** false when the expression did not parse — the attestable-prose fallback. */
  structural: boolean;
  valid: boolean;
  identity_hash: string;
  full_hash: string;
  identity_core: string;
  canonical_expression: string | null;
  attribute_ids: number[];
  literals: unknown[];
  hash_inputs: Record<string, unknown>;
  error: string | null;
}

/** Step 13a's input, drafted alongside the rules (Step 11). */
export interface AiDefinition {
  term: string;
  expression: string;
  meaning: string;
  inputs: Record<string, { data_type?: string; meaning?: string; unit?: string }>;
  confidence: number;
}

/** Step 12's input, drafted alongside the rules (Step 11). */
export interface AiModifier {
  targets: string;
  effect: 'restrict_scope' | 'exempt' | 'extend_scope' | 'override_value';
  /** 'firm' may touch a rule's audience; 'scope' may not. Measured: roughly two
   *  of thirty-four real SEBI modifiers are 'firm'. */
  condition_kind: 'firm' | 'scope';
  condition: string | null;
  scope_note: string | null;
  value: string | null;
  confidence: number;
  raw: string;
}

export interface AiRule {
  title: string;
  rule_expression: string;
  result_pass: string;
  result_fail: string;
  attribute_hints: Record<string, { data_type: string; meaning: string; unit?: string }>;
  obligation_type: string;
  context: string;
  source_clause: string;
  /** Step 11's structured precondition, promoted to an audience at Step 13d. */
  precondition?: string | null;
  /** What the model supplied that the clause did not state. Declared, not hidden. */
  inferred?: string[];
  confidence: number;
  ast: {
    valid: boolean;
    functions: string[];
    identifiers: string[];
    literals: (number | string)[];
    error: string | null;
  };
}

export interface AiExtractResponse {
  doc_id: string;
  drafter: string; // "mock" means heuristic placeholder drafts (no LLM key)
  model: string;
  results: {
    idx: number;
    clause_no: string | null;
    rules: AiRule[];
    /** Step 12's input. Drafted here because it reads the same window; consumed
     *  much later, because assembly cannot start until every window is done. */
    modifiers?: AiModifier[];
    /** Step 13a. Registered BEFORE any rule resolves. */
    definitions?: AiDefinition[];
    error: string | null;
  }[];
}

/** M3 attribute judge — fires only on the ambiguous middle of the funnel. */
export interface AiJudgeVerdict {
  match_index: number; // index into the candidates sent, -1 = none → create new
  same: boolean;
  reason: string;
  confidence: number;
  judge: string; // "mock" | "openai" | …
}

@Injectable()
export class AiClientService {
  private readonly log = new Logger('AiClient');
  private readonly base = process.env.AI_SERVICE_URL || 'http://ai-service:8000';
  private readonly key = process.env.AI_SERVICE_KEY || '';

  private async post<T>(path: string, body: FormData | object): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'X-AI-Key': this.key,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      },
      body: isForm ? body : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ai-service ${path} → ${res.status}: ${detail.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  parsePdf(docId: string, filename: string, data: Buffer): Promise<AiParseResponse> {
    const form = new FormData();
    form.append('doc_id', docId);
    form.append('file', new Blob([new Uint8Array(data)], { type: 'application/pdf' }), filename);
    return this.post<AiParseResponse>('/parse-pdf', form);
  }

  extract(
    docId: string,
    windows: { idx: number; clause_no: string | null; page: number; char_start: number; char_end: number; window_text: string }[],
  ): Promise<AiExtractResponse> {
    return this.post<AiExtractResponse>('/extract', { doc_id: docId, windows });
  }

  async embed(texts: string[]): Promise<{ embeddings: number[][]; model: string; mock: boolean }> {
    return this.post('/embed', { texts });
  }

  /** Step 10a — Pattern C. One call per DOCUMENT, not per clause. */
  documentAudience(
    docId: string,
    title: string | null,
    clauses: string[],
  ): Promise<AiAudience> {
    return this.post<AiAudience>('/audience/document', {
      doc_id: docId,
      title,
      clauses,
    });
  }

  /**
   * Compose parent + an added condition into a normalised, hashed test.
   *
   * Step 12 narrows audiences as well as Step 10, and normalisation lives in
   * exactly one place. Re-implementing it here would let a modifier-narrowed
   * audience and a heading-narrowed one describing the SAME firms hash
   * differently — rung 3 would miss and the rules would split across two nodes.
   */
  composeAudience(
    parentConditions: string[],
    added: string,
    relation = 'narrows',
  ): Promise<{
    ok: boolean;
    normalised: string;
    conditions: string[];
    predicate_hash: string | null;
    error: string | null;
  }> {
    return this.post('/audience/compose', {
      parent_conditions: parentConditions,
      added,
      relation,
    });
  }

  /**
   * Step 10b — Pattern A. Every heading in the document, batched.
   *
   * There is no gate in front of this. A phrase gate was designed, measured and
   * deleted (decision 63) — it scored 0 of 148 real headings, and its failure
   * mode was silent: a section inheriting the wrong audience misfiles every rule
   * beneath it. A wasted call answering "topic" costs nothing by comparison.
   */
  async headingAudiences(
    docId: string,
    headings: AiHeadingIn[],
  ): Promise<{ provider: string; results: AiHeadingAudience[] }> {
    if (!headings.length) return { provider: 'none', results: [] };
    return this.post('/audience/headings', { doc_id: docId, headings });
  }

  /** Step 14 — canonical rewrite + both fingerprints. Batched: one call per
   *  document rather than one per rule. */
  async fingerprint(items: AiFingerprintItem[]): Promise<AiFingerprint[]> {
    if (!items.length) return [];
    const res = await this.post<{ results: AiFingerprint[] }>('/fingerprint', { items });
    return res.results;
  }

  /** Step 10, rung 6. Only for the ambiguous middle rungs 3-5 could not settle. */
  judgeAudience(
    candidate: { label: string; predicate: string },
    existing: { id: number; label: string; predicate: string }[],
  ): Promise<{ same: boolean; match_index: number; confidence: number; why: string | null }> {
    return this.post('/judge/audience', { candidate, existing });
  }

  judgeAttribute(
    token: { name: string; meaning: string; topic: string },
    candidates: { id: number; name: string; category: string; description: string }[],
  ): Promise<AiJudgeVerdict> {
    return this.post<AiJudgeVerdict>('/judge/attribute', { token, candidates });
  }
}
