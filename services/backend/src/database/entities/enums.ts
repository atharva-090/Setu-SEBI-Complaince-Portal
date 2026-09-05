// Backend mirror of the shared/types unions (the backend can't import shared/types
// across the Docker build context, so these are kept aligned by hand).

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
/** Step 15's five verdicts. */
export type FilingVerdict =
  | 'restatement'
  | 'amendment'
  | 'new'
  | 'repeal'
  | 'ambiguous';
/** Which of Step 15's three lanes produced the verdict. */
export type FilingLane = 'fingerprint' | 'citation' | 'fuzzy';
export type CitationState = 'PENDING' | 'RESOLVED' | 'ABANDONED';
/** An edge resolved ambiguously must not read as an accepted fact (16c). */
export type EdgeState = 'ACTIVE' | 'REVIEW';

export type DataType = 'date' | 'number' | 'boolean' | 'string' | 'document';
export type EvalMethod = 'rule_exec' | 'evidence_check';

export interface SourceSpan {
  doc_id: string;
  clause: string;
  page: number;
  char: [number, number];
}
