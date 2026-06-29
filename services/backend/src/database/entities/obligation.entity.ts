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

  @Column({ default: 'computable' })
  obligationType: ObligationType;

  @Column({ nullable: true })
  context: string;

  @Column({ nullable: true })
  identityHash: string;

  @Column({ nullable: true })
  fullHash: string;

  @Column('jsonb', { default: () => "'[]'" })
  sourceSpans: SourceSpan[];

  @Column({ default: 1 })
  version: number;

  @Column({ default: 'ACTIVE' })
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
