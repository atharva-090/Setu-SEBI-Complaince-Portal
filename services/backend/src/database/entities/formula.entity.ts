import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { GovernanceState } from './enums';

/**
 * Step 13a — the Formula Register.
 *
 * A definition is not a rule. *"net worth = paid_up_capital + free_reserves −
 * accumulated_losses"* imposes no duty; it says how one fact is COMPUTED from
 * others. Storing it here is what stops the funnel meeting `net_worth` in a
 * later rule and creating it as an ordinary attribute — which would put "what is
 * your net worth?" on the intake form instead of computing it from figures the
 * firm has already given.
 *
 * The rule this enforces: **the intake form only ever asks for the LEAVES of the
 * formula tree.**
 */
@Entity('formulas')
export class Formula {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The attribute this computes. UNIQUE, deliberately: two circulars defining
   * the same term differently is an AMENDMENT to the definition, not a second
   * definition, and collapsing them into two rows would hide that.
   */
  @Column({ unique: true })
  attributeId: number;

  /** As written, with registry refs substituted. */
  @Column()
  expression: string;

  /** The attributes it reads. A firm supplies these; never the result. */
  @Column('int', { array: true, default: () => "'{}'" })
  inputIds: number[];

  @Column({ nullable: true })
  sourceDoc: string;

  @Column({ nullable: true })
  sourceClause: string;

  @Column({ type: 'real', nullable: true })
  confidence: number;

  @Column('text', { default: 'REVIEW' })
  state: GovernanceState;

  @CreateDateColumn()
  createdAt: Date;
}
