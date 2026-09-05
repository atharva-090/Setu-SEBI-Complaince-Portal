import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DataType } from './enums';

@Entity('attributes')
export class Attribute {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  category: string;

  @Column()
  canonicalName: string;

  @Column('text')
  dataType: DataType;

  @Column({ nullable: true })
  unit: string;

  @Column()
  description: string;

  @Column('text', { array: true, default: () => "'{}'" })
  aliases: string[];

  @Column({ type: 'text', nullable: true, select: false })
  embedding: string;

  @Column({ nullable: true })
  createdFrom: string;

  /**
   * Step 13a. True when this attribute is COMPUTED from others rather than
   * supplied by the firm. The intake form only ever asks for the leaves.
   */
  @Column({ default: false })
  isDerived: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
