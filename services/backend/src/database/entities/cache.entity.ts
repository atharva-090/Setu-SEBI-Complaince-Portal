import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('cache')
export class CacheEntry {
  @PrimaryColumn()
  key: string;

  @Column({ nullable: true })
  namespace: string;

  @Column('jsonb', { nullable: true })
  value: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
