import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { EdgeState, EdgeType } from './enums';

@Entity('edges')
export class Edge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  fromId: number;

  @Column()
  toId: number;

  @Column('text')
  type: EdgeType;

  /** Why this edge exists: the citing clause and its span. Without it an
   * auditor cannot be shown why the graph believes A depends on B (16c). */
  @Column('jsonb', { nullable: true })
  sourceCitation: Record<string, unknown>;

  @Column({ type: 'real', nullable: true })
  confidence: number;

  @Column('text', { default: 'ACTIVE' })
  state: EdgeState;

  @CreateDateColumn()
  createdAt: Date;
}
