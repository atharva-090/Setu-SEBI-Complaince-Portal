import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The applicability layer (Step 10). An audience is a SET OF FIRMS, so it is
 * matched by its normalised test character-for-character — never by name
 * similarity. `predicateHash` is that exact-match key.
 */
@Entity('audiences')
export class Audience {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  label: string;

  @Column()
  predicate: string;

  @Column({ unique: true })
  predicateHash: string;

  @Column('text', { array: true, default: () => "'{}'" })
  properties: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  aliases: string[];

  @Column({ nullable: true })
  pattern: string; // C | A | B — which applicability pattern produced it

  @Column({ nullable: true })
  createdFrom: string;

  /**
   * Step 10e — the approval gate. PROPOSED until a human says otherwise.
   *
   * This is the one deliberate interruption in the pipeline. New audiences are
   * rare (a few dozen across SEBI's whole regulated universe), and one click
   * prevents the duplicate-branch failure outright — two nodes for one group,
   * rules split across both, a firm seeing half its obligations with no sign
   * the rest exists.
   */
  @Column('text', { default: 'PROPOSED' })
  state: 'PROPOSED' | 'APPROVED';

  /** What the classifier claimed. Kept so the queue can be ordered by doubt. */
  @Column({ type: 'real', nullable: true })
  confidence: number;

  @Column({ nullable: true })
  approvedBy: string;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
