import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../database/entities';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { JwtPayload } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface AuthResult {
  access_token: string;
  user: { id: string; email: string; role: string; tenantId: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issue(user);
  }

  /** Intermediary self-registration: creates a tenant + an intermediary user. */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const tenant = await this.tenants.create({
      name: dto.tenantName,
      category: dto.category,
      profile: dto.profile ?? {},
    });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      role: 'intermediary',
      tenantId: tenant.id,
    });

    return this.issue(user);
  }

  private issue(user: User): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? null,
    };
    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ?? null,
      },
    };
  }
}
