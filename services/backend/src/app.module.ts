import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ALL_ENTITIES } from './database/entities';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { SeedModule } from './seed/seed.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'postgres',
      port: Number(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || 'setu_user',
      password: process.env.DB_PASSWORD || 'setu_password',
      database: process.env.DB_DATABASE || 'setu_db',
      entities: ALL_ENTITIES,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    }),
    AuthModule,
    UsersModule,
    TenantsModule,
    SeedModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
