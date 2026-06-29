import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('facts')
@Unique(['tenantId', 'attributeId'])
export class Fact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('uuid')
  tenantId: string;

  @Column()
  attributeId: number;

  @Column({ nullable: true })
  value: string;

  @Column({ nullable: true })
  source: string;

  @Column('uuid', { nullable: true })
  enteredBy: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  enteredAt: Date;
}
