import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { INestApplication } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/shared/errors/http-exception.filter';

describe('Correlation header', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
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

  it('error response carries the same correlationId as the response header', async () => {
    // Hit a non-existent route to trigger Nest's NotFoundException through GlobalExceptionFilter.
    const r = await request(app.getHttpServer()).get('/no-such-route').expect(404);
    expect(r.headers['x-correlation-id']).toBeDefined();
    // Body shape comes from the HttpException branch of the filter (preserves Nest's body + adds correlationId).
    expect(r.body.correlationId).toBeDefined();
    expect(r.body.correlationId).toBe(r.headers['x-correlation-id']);
  });
});
