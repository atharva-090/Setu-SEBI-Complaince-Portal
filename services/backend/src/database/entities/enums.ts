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
  | 'shared_evidence'
  /** Step 12's `override_value`: a stricter rule for a narrower group that
   *  REPLACES a general one for that group, without amending it. All brokers
   *  keep the 180-day rule; QSBs get a 90-day rule that overrides it, and a
   *  QSB's dashboard shows only the 90-day version with the original one click
   *  away. Distinct from `amends`, which changes the rule for everyone. */
  | 'overrides';
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
