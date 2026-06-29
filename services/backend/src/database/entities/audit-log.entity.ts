import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  seq: string;

  @Column()
  event: string;

  @Column({ nullable: true })
  actor: string;

  @Column('jsonb', { nullable: true })
  before: Record<string, unknown>;

  @Column('jsonb', { nullable: true })
  after: Record<string, unknown>;

  @Column('jsonb', { nullable: true })
  clauseRefs: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  ts: Date;

  @Column({ nullable: true })
  prevHash: string;

  @Column({ nullable: true })
  rowHash: string;
}
