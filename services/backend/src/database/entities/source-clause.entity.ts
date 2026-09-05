import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('source_clauses')
export class SourceClause {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  docId: string;

  @Column({ nullable: true })
  clauseNo: string;

  @Column({ nullable: true })
  heading: string;

  @Column({ nullable: true })
  parentId: number;

  @Column({ nullable: true })
  page: number;

  @Column({ nullable: true })
  charStart: number;

  @Column({ nullable: true })
  charEnd: number;

  @Column()
  text: string;

  /** Set on the block carrying the document's subject line (task B2). */
  @Column({ default: false })
  isTitle: boolean;

  /** "Master Circular for Stock Brokers" — Pattern C's primary input (D1). */
  @Column({ nullable: true })
  titleText: string;

  // pgvector column; read/written as raw text by the AI-service paths (not here).
  @Column({ type: 'text', nullable: true, select: false })
  embedding: string;

  @CreateDateColumn()
  createdAt: Date;
}
