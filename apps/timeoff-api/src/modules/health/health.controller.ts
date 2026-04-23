import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import IORedis from 'ioredis';

interface CheckStatus { status: 'up' | 'down'; latencyMs?: number; error?: string; }
interface ReadinessReport {
  status: 'ok' | 'degraded';
  db: CheckStatus;
  redis: CheckStatus;
  hcm: CheckStatus;
}

@Controller('health')
export class HealthController {
  private readonly redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    const [db, redis, hcm] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkHcm(),
    ]);
    const allUp = db.status === 'up' && redis.status === 'up' && hcm.status === 'up';
    const report: ReadinessReport = { status: allUp ? 'ok' : 'degraded', db, redis, hcm };
    if (!allUp) {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  private async checkDb(): Promise<CheckStatus> {
    const t = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - t };
    } catch (e: any) {
      return { status: 'down', error: e.message };
    }
  }

  private async checkRedis(): Promise<CheckStatus> {
    const t = Date.now();
    try {
      if (this.redis.status !== 'ready') {
        await this.redis.connect().catch(() => undefined);
      }
      const pong = await this.redis.ping();
      if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);
      return { status: 'up', latencyMs: Date.now() - t };
    } catch (e: any) {
      return { status: 'down', error: e.message ?? String(e) };
    }
  }

  private async checkHcm(): Promise<CheckStatus> {
    const t = Date.now();
    const url = process.env.HCM_BASE_URL ?? 'http://localhost:4000';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`${url}/hcm/balances/_/_`, { signal: ctrl.signal });
      clearTimeout(timer);
      // Even a 404 means the server is up; only 5xx or network failure = down
      if (res.status >= 500) return { status: 'down', latencyMs: Date.now() - t, error: `status ${res.status}` };
      return { status: 'up', latencyMs: Date.now() - t };
    } catch (e: any) {
      return { status: 'down', error: e.message ?? String(e) };
    }
  }
}
