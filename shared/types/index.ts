// Setu shared types — the cross-cutting contract (consumed by the frontend; the
// backend mirrors these in its TypeORM entities). Keep field names aligned with the
// snake_case DB columns conceptually; the frontend receives camelCase from the API.

// ── Enums / unions ───────────────────────────────────────────────────────────

export type Role = 'sebi_admin' | 'intermediary';

export type IntermediaryCategory = 'stock_broker' | 'investment_adviser';

export type ObligationType = 'computable' | 'attestable';

export type EvalStatus = 'GREEN' | 'RED' | 'GREY' | 'AMBER';

export type GovernanceState = 'PROPOSED' | 'ACTIVE' | 'REVIEW' | 'SUPERSEDED';

export type EdgeType =
  | 'amends'
  | 'supersedes'
  | 'split_of'
  | 'depends_on'
  | 'shared_evidence';

export type ChangeClassification =
  | 'new'
  | 'amended'
  | 'replaced'
  | 'split'
  | 'no_change';

export type DataType = 'date' | 'number' | 'boolean' | 'string' | 'document';

export type EvalMethod = 'rule_exec' | 'evidence_check';

// ── Global graph ─────────────────────────────────────────────────────────────

export interface SourceSpan {
  doc_id: string;
  clause: string;
  page: number;
  char: [number, number];
}

export interface ClauseNode {
  id: number;
  doc_id: string;
  clause_no: string | null;
  heading: string | null;
  parent_id: number | null;
  page: number | null;
  char_start: number | null;
  char_end: number | null;
  text: string;
}

export interface Attribute {
  id: number;
  category: string;
  canonical_name: string;
  data_type: DataType;
  unit: string | null;
  description: string;
  aliases: string[];
  created_from: string | null;
}

export interface Obligation {
  id: number;
  title: string;
  rule_expression: string;
  result_pass: string | null;
  result_fail: string | null;
  attribute_ids: number[];
  obligation_type: ObligationType;
  context: string | null;
  identity_hash: string | null;
  full_hash: string | null;
  source_spans: SourceSpan[];
  version: number;
  state: GovernanceState;
  confidence: number | null;
}

export interface Edge {
  id: number;
  from_id: number;
  to_id: number;
  type: EdgeType;
}

export interface ObligationVersion {
  id: number;
  obligation_id: number;
  version: number;
  valid_from: string;
  valid_to: string | null;
  superseded_reason: string | null;
}

// ── Per-tenant state ─────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  category: IntermediaryCategory;
  profile: Record<string, unknown>;
}

export interface Fact {
  id: number;
  tenant_id: string;
  attribute_id: number;
  value: string | null;
  source: string | null;
  entered_at: string;
}

export interface Evaluation {
  id: number;
  obligation_id: number;
  tenant_id: string;
  status: EvalStatus;
  reason: string | null;
  method: EvalMethod | null;
  computed: Record<string, unknown> | null;
  evaluated_at: string;
}

export interface Evidence {
  id: number;
  tenant_id: string;
  attribute_id: number;
  file_ref: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string | null;
}

// ── Platform ─────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: Role;
  tenant_id: string | null;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}

// ── Amendment loop (M6) ──────────────────────────────────────────────────────

export interface ChangeSetOp {
  kind: 'create' | 'amend' | 'supersede' | 'split';
  obligation_id?: number;
  changed_fields?: Record<string, { old: unknown; new: unknown }>;
}

export interface ChangeSet {
  id: string;
  doc_id: string;
  state: GovernanceState;
  ops: ChangeSetOp[];
  classification: ChangeClassification;
}

// ── Graph canvas view-model (frontend) ───────────────────────────────────────

export interface GraphNode {
  id: number;
  title: string;
  category: string;
  status: EvalStatus | null;
}

export interface GraphView {
  nodes: GraphNode[];
  edges: Edge[];
}
