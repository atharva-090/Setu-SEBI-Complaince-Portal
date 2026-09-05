import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { EvalMethod, EvalStatus } from './enums';

@Entity('evaluations')
@Unique(['obligationId', 'tenantId'])
export class Evaluation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  obligationId: number;

  @Column('uuid')
  tenantId: string;

  @Column('text')
  status: EvalStatus;

  @Column({ nullable: true })
  reason: string;

  @Column('text', { nullable: true })
  method: EvalMethod;

  @Column('jsonb', { nullable: true })
  computed: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  evaluatedAt: Date;
}
