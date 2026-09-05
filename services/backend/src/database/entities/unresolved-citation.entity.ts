import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CitationState, EdgeType } from './enums';

/**
 * The retry queue Step 16b sweeps. A 2024 circular cites a 2019 one that has not
 * been ingested; park it here, and when the 2019 document lands ask "who was
 * waiting for me?".
 *
 * `targetContainer` is not optional in practice: CSCRF's numbering restarts in
 * every annexure, so clause "1" exists 152 times. A citation keyed on the number
 * alone cannot be resolved.
 */
@Entity('unresolved_citations')
export class UnresolvedCitation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  fromClauseId: number;

  @Column({ nullable: true })
  fromObligationId: number;

  @Column()
  rawText: string;

  @Column({ nullable: true })
  targetDoc: string;

  @Column({ nullable: true })
  targetContainer: string;

  @Column({ nullable: true })
  targetClauseNo: string;

  @Column('text', { nullable: true })
  edgeType: EdgeType;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date;

  @Column('text', { default: 'PENDING' })
  state: CitationState;

  @Column({ nullable: true })
  resolvedEdgeId: number;

  @CreateDateColumn()
  createdAt: Date;
}
