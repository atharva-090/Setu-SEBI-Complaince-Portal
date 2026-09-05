import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { FilingLane, FilingVerdict } from './enums';

/**
 * The append-only event log (Step 15a). Filing does not mutate the graph — it
 * appends "document D asserts rule R, effective E, verdict V". The live graph is
 * a projection, replayed in effective-date order.
 *
 * NEVER update or delete a row here: a database trigger rejects both. A
 * correction is a new row with `correctsSeq` pointing at what it corrects.
 */
@Entity('rule_assertions')
export class RuleAssertion {
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'seq' })
  seq: string;

  @Column()
  docId: string;

  @Column({ nullable: true })
  clauseId: number;

  @Column({ nullable: true })
  obligationId: number;

  @Column({ nullable: true })
  audienceId: number;

  @Column({ nullable: true })
  identityHash: string;

  @Column({ nullable: true })
  fullHash: string;

  @Column('text')
  verdict: FilingVerdict;

  @Column('text', { nullable: true })
  lane: FilingLane;

  /** Replay order. The date the rule takes effect — NOT the ingestion date. */
  @Column({ type: 'date' })
  effectiveFrom: string;

  @Column('jsonb', { default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ type: 'bigint', nullable: true })
  correctsSeq: string;

  @Column({ nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;
}
