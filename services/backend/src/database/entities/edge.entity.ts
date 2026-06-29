import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { EdgeType } from './enums';

@Entity('edges')
export class Edge {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  fromId: number;

  @Column()
  toId: number;

  @Column()
  type: EdgeType;

  @CreateDateColumn()
  createdAt: Date;
}
