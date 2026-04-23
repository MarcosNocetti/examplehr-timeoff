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

  // Real employee IDs — manager RBAC on GET /requests requires Employee rows.
  let empId1: string;
  let empId2: string;
  let mgrId: string;

  beforeAll(async () => {
    process.env.OUTBOX_POLL_DISABLED = '1';
    process.env.SKIP_SEED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // Seed test employees.
    await prisma.employee.deleteMany();
    const mgr = await prisma.employee.create({
      data: { name: 'Test Manager', email: 'mgr@test.dev', role: Role.MANAGER },
    });
    mgrId = mgr.id;
    const e1 = await prisma.employee.create({
      data: { name: 'Test E1', email: 'e1@test.dev', role: Role.EMPLOYEE, managerId: mgr.id },
    });
    empId1 = e1.id;
    const e2 = await prisma.employee.create({
      data: { name: 'Test E2', email: 'e2@test.dev', role: Role.EMPLOYEE, managerId: mgr.id },
    });
    empId2 = e2.id;
  });

  afterAll(async () => {
    await prisma.employee.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.balance.create({
      data: { employeeId: empId1, locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
  });

  const employee = (id?: string) => ({ 'x-employee-id': id ?? empId1, 'x-role': Role.EMPLOYEE });
  const manager = (id?: string) => ({ 'x-employee-id': id ?? mgrId, 'x-role': Role.MANAGER });

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

  it('GET /requests filters to own when employee, manager sees team', async () => {
    // Seed balance for e2 and create requests for both employees
    await prisma.balance.create({
      data: { employeeId: empId2, locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
    await request(app.getHttpServer()).post('/requests').set(employee(empId1))
      .send({ locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01', idempotencyKey: 'a' });
    await request(app.getHttpServer()).post('/requests').set(employee(empId2))
      .send({ locationId: 'l1', startDate: '2026-05-01', endDate: '2026-05-01', idempotencyKey: 'b' });

    // Employee sees only own
    const r = await request(app.getHttpServer()).get('/requests').set(employee(empId1)).expect(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].employeeId).toBe(empId1);

    // Manager sees their team (both e1 and e2 report to this manager)
    const r2 = await request(app.getHttpServer()).get('/requests').set(manager()).expect(200);
    expect(r2.body.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /requests/:id 404 when missing', async () => {
    await request(app.getHttpServer()).get('/requests/no-such-id').set(employee()).expect(404);
  });
});
