import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ingestion_runs')
export class IngestionRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  docId: string;

  @Column({ default: 'pending' })
  status: string;

  @Column('jsonb', { default: () => "'{}'" })
  stages: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date;

  @Column({ nullable: true })
  error: string;
}
