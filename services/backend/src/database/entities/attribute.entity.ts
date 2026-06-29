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

  @Column()
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

  @CreateDateColumn()
  createdAt: Date;
}
