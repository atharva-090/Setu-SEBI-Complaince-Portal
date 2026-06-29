import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { IntermediaryCategory } from '../database/entities/enums';

interface SeedTenant {
  name: string;
  category: IntermediaryCategory;
  profile: Record<string, unknown>;
  email: string;
  password: string;
}

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SEED_ON_BOOT === 'false') return;

    const existing = await this.users.count();
    if (existing > 0) {
      this.log.log(`Skipping seed (${existing} users already present).`);
      return;
    }

    // 1 SEBI admin
    await this.users.create({
      email: 'admin@sebi.gov.in',
      passwordHash: await bcrypt.hash('Admin@123', 10),
      role: 'sebi_admin',
      tenantId: null,
    });

    // 3 intermediaries: one QSB, one small broker, one investment adviser
    const seedTenants: SeedTenant[] = [
      {
        name: 'Sharma Securities Pvt Ltd',
        category: 'stock_broker',
        profile: { is_qsb: true, holds_client_funds: true },
        email: 'compliance@sharmasec.com',
        password: 'Broker@123',
      },
      {
        name: 'Patel Broking Services',
        category: 'stock_broker',
        profile: { is_qsb: false, holds_client_funds: true },
        email: 'compliance@patelbroking.com',
        password: 'Broker@123',
      },
      {
        name: 'Mehta Investment Advisers',
        category: 'investment_adviser',
        profile: { is_qsb: false, holds_client_funds: false },
        email: 'compliance@mehtaadvisers.com',
        password: 'Adviser@123',
      },
    ];

    for (const t of seedTenants) {
      const tenant = await this.tenants.create({
        name: t.name,
        category: t.category,
        profile: t.profile,
      });
      await this.users.create({
        email: t.email,
        passwordHash: await bcrypt.hash(t.password, 10),
        role: 'intermediary',
        tenantId: tenant.id,
      });
    }

    this.log.log(
      'Seeded: 1 sebi_admin (admin@sebi.gov.in) + 3 intermediaries (QSB, small broker, IA).',
    );
  }
}
