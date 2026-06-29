import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('obligation_versions')
export class ObligationVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  obligationId: number;

  @Column()
  version: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  validFrom: Date;

  @Column({ type: 'timestamptz', nullable: true })
  validTo: Date;

  @Column({ nullable: true })
  supersededReason: string;

  @Column('jsonb', { nullable: true })
  snapshot: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
