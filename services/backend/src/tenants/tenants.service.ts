import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../database/entities';
import { IntermediaryCategory } from '../database/entities/enums';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly repo: Repository<Tenant>,
  ) {}

  findAll(): Promise<Tenant[]> {
    return this.repo.find();
  }

  findById(id: string): Promise<Tenant | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: {
    name: string;
    category: IntermediaryCategory;
    profile?: Record<string, unknown>;
  }): Promise<Tenant> {
    const tenant = this.repo.create({
      name: data.name,
      category: data.category,
      profile: data.profile ?? {},
    });
    return this.repo.save(tenant);
  }
}
