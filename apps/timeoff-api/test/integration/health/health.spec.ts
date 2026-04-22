import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/shared/errors/http-exception.filter';

describe('Health endpoints (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());

  it('GET /health returns 200 with status ok', async () => {
    const r = await request(app.getHttpServer()).get('/health').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports per-dependency status (db should be up; redis/hcm down without infra)', async () => {
    const r = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(r.body.status).toMatch(/ok|degraded/);
    expect(r.body.db.status).toBe('up');
    // Redis and HCM are typically down in isolated Jest runs
    expect(r.body.redis).toBeDefined();
    expect(r.body.hcm).toBeDefined();
  });
});
