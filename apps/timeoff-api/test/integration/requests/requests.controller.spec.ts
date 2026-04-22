import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { GlobalExceptionFilter } from '../../../src/shared/errors/http-exception.filter';
import { Role } from '@examplehr/contracts';

describe('Requests HTTP surface (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.balance.create({
      data: { employeeId: 'e1', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
  });

  const employee = (id = 'e1') => ({ 'x-employee-id': id, 'x-role': Role.EMPLOYEE });
  const manager = (id = 'm1') => ({ 'x-employee-id': id, 'x-role': Role.MANAGER });

  it('POST /requests creates a request', async () => {
    const r = await request(app.getHttpServer())
      .post('/requests')
      .set(employee())
      .send({
        locationId: 'l1',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        idempotencyKey: 'k1',
      })
      .expect(201);
    expect(r.body.id).toBeDefined();
    expect(r.body.status).toBe('PENDING_APPROVAL');
  });

  it('POST /requests rejects manager (employee-only)', async () => {
    await request(app.getHttpServer())
      .post('/requests')
      .set(manager())
      .send({
        locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01', idempotencyKey: 'k2',
      })
      .expect(403);
  });

  it('POST /requests rejects invalid body (missing idempotencyKey)', async () => {
    await request(app.getHttpServer())
      .post('/requests')
      .set(employee())
      .send({ locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01' })
      .expect(400);
  });

  it('GET /requests filters to own when employee', async () => {
    // Seed two requests under different employees
    await prisma.balance.create({
      data: { employeeId: 'e2', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
    await request(app.getHttpServer()).post('/requests').set(employee('e1'))
      .send({ locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01', idempotencyKey: 'a' });
    await request(app.getHttpServer()).post('/requests').set(employee('e2'))
      .send({ locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01', idempotencyKey: 'b' });

    const r = await request(app.getHttpServer()).get('/requests').set(employee('e1')).expect(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].employeeId).toBe('e1');

    const r2 = await request(app.getHttpServer()).get('/requests').set(manager()).expect(200);
    expect(r2.body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /requests/:id 404 when missing', async () => {
    await request(app.getHttpServer()).get('/requests/no-such-id').set(employee()).expect(404);
  });
});
