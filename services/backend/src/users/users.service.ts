import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities';
import { Role } from '../database/entities/enums';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  count(): Promise<number> {
    return this.repo.count();
  }

  create(data: {
    email: string;
    passwordHash: string;
    role: Role;
    tenantId?: string | null;
  }): Promise<User> {
    const user = this.repo.create({
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      tenantId: data.tenantId ?? null,
    });
    return this.repo.save(user);
  }
}
