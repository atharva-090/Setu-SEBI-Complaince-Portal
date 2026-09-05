import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Containment in the audience lattice — a DAG, so the key is the pair. */
@Entity('audience_edges')
export class AudienceEdge {
  @PrimaryColumn()
  narrowerId: number;

  @PrimaryColumn()
  broaderId: number;

  @Column({ nullable: true })
  derivation: string;

  @CreateDateColumn()
  createdAt: Date;
}
