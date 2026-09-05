import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column('text')
  role: Role;

  @Column('uuid', { nullable: true })
  tenantId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
