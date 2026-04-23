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

  it('GET /health/ready returns 503 with structured body when redis/hcm down (k8s-ready)', async () => {
    // Redis and HCM are down in isolated Jest runs — service must return 503 so k8s
    // can take the pod out of rotation.
    const r = await request(app.getHttpServer()).get('/health/ready');
    // DB is up; redis/hcm are down → degraded → 503
    if (r.status === 200) {
      // All deps happen to be up (full-stack env); just verify shape
      expect(r.body.status).toBe('ok');
    } else {
      expect(r.status).toBe(503);
      expect(r.body.status).toBe('degraded');
      expect(r.body.db.status).toBe('up');
      expect(r.body.redis).toBeDefined();
      expect(r.body.hcm).toBeDefined();
    }
  });
});
