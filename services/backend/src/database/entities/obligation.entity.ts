import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GovernanceState, ObligationType, SourceSpan } from './enums';

@Entity('obligations')
export class Obligation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  ruleExpression: string;

  @Column({ nullable: true })
  resultPass: string;

  @Column({ nullable: true })
  resultFail: string;

  @Column('int', { array: true, default: () => "'{}'" })
  attributeIds: number[];

  @Column('text', { default: 'computable' })
  obligationType: ObligationType;

  @Column({ nullable: true })
  context: string;

  /** The audience this rule was filed under. Enters identityHash BY ID — by
   * shape, 'stock_broker' and 'mutual_fund' both mask to [category]==STR and
   * two coexisting duties silently collapse into one. Decisions 74, 75. */
  @Column({ nullable: true })
  audienceId: number;

  /** The clause that produced this rule. A citation names a CLAUSE and an edge
   * joins RULES; this is the map between them (Step 16). `source_spans` carries
   * the clause NUMBER, and a number is not a key — Decision 66. */
  @Column({ nullable: true })
  sourceClauseId: number;

  @Column({ nullable: true })
  identityHash: string;

  @Column({ nullable: true })
  fullHash: string;

  /** What went INTO the hashes: audience id, sorted attribute ids, canonical
   * tree. Identity is built from registry ids, and Step 13's cold-start
   * clustering renumbers those — storing the inputs makes a registry migration
   * a re-derivation instead of a re-ingest. Decision 78. */
  @Column('jsonb', { nullable: true })
  hashInputs: Record<string, unknown>;

  @Column('jsonb', { default: () => "'[]'" })
  sourceSpans: SourceSpan[];

  /** What Step 12 applied. NOT a column — it is carried from assembly to the
   *  fingerprint merge in one run and folded into `hashInputs` there. */
  assemblyNote?: Record<string, unknown>;

  @Column({ default: 1 })
  version: number;

  @Column('text', { default: 'ACTIVE' })
  state: GovernanceState;

  @Column({ type: 'real', nullable: true })
  confidence: number;

  @Column({ type: 'text', nullable: true, select: false })
  embedding: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
