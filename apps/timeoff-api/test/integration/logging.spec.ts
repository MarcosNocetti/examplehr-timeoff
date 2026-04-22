import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { INestApplication } from '@nestjs/common';

describe('Correlation header', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());

  it('echoes provided x-correlation-id', async () => {
    const r = await request(app.getHttpServer()).get('/health').set('x-correlation-id', 'abc-123').expect(404);
    expect(r.headers['x-correlation-id']).toBe('abc-123');
  });
  it('generates one if absent', async () => {
    const r = await request(app.getHttpServer()).get('/health').expect(404);
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
