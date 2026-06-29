import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { IntermediaryCategory } from './enums';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  category: IntermediaryCategory;

  @Column('jsonb', { default: () => "'{}'" })
  profile: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
