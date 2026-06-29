import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check() {
    let db = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }

    let ai = 'down';
    try {
      const res = await fetch(`${process.env.AI_SERVICE_URL || ''}/health`);
      ai = res.ok ? 'up' : 'down';
    } catch {
      ai = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      service: 'setu-backend',
      db,
      ai,
      timestamp: new Date().toISOString(),
    };
  }
}
