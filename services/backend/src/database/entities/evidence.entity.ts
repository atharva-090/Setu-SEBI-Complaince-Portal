import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('evidence')
export class Evidence {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('uuid')
  tenantId: string;

  @Column()
  attributeId: number;

  @Column({ nullable: true })
  fileRef: string;

  @Column({ type: 'date', nullable: true })
  validFrom: string;

  @Column({ type: 'date', nullable: true })
  validTo: string;

  @Column({ nullable: true })
  status: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  uploadedAt: Date;
}
