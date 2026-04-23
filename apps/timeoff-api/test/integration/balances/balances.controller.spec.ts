import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { GlobalExceptionFilter } from '../../../src/shared/errors/http-exception.filter';
import { Role, MovementType } from '@examplehr/contracts';

describe('GET /balances/:employeeId (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Real employee IDs set up in beforeAll — the manager RBAC check requires
  // Employee rows to exist in the DB (it looks up managerId to verify team membership).
  let employeeId1: string;
  let employeeId2: string;
  let managerId: string;

  beforeAll(async () => {
    process.env.SKIP_SEED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // Seed test employees (manager + 2 reports).
    await prisma.employee.deleteMany();
    const mgr = await prisma.employee.create({
      data: { name: 'Test Manager', email: 'mgr@test.dev', role: Role.MANAGER },
    });
    managerId = mgr.id;
    const e1 = await prisma.employee.create({
      data: { name: 'Test E1', email: 'e1@test.dev', role: Role.EMPLOYEE, managerId: mgr.id },
    });
    employeeId1 = e1.id;
    const e2 = await prisma.employee.create({
      data: { name: 'Test E2', email: 'e2@test.dev', role: Role.EMPLOYEE, managerId: mgr.id },
    });
    employeeId2 = e2.id;
  });

  afterAll(async () => {
    await prisma.employee.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.timeOffMovement.deleteMany();
    await prisma.balance.deleteMany();
  });

  it('returns derived available = total - reserved', async () => {
    await prisma.balance.create({
      data: { employeeId: employeeId1, locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
    await prisma.timeOffMovement.create({
      data: { employeeId: employeeId1, locationId: 'l1', delta: '-3', type: MovementType.PENDING_RESERVATION },
    });
    const r = await request(app.getHttpServer())
      .get(`/balances/${employeeId1}`)
      .set('x-employee-id', employeeId1).set('x-role', Role.EMPLOYEE)
      .expect(200);
    expect(r.body[0]).toMatchObject({
      employeeId: employeeId1,
      locationId: 'l1',
      totalDays: '10',
      availableDays: '7',
    });
  });

  it('rejects when employee tries to read another employee', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${employeeId2}`)
      .set('x-employee-id', employeeId1).set('x-role', Role.EMPLOYEE)
      .expect(403);
  });

  it('manager can read own team member balance', async () => {
    await prisma.balance.create({
      data: { employeeId: employeeId2, locationId: 'l1', totalDays: '5', hcmLastSeenAt: new Date(), version: 1 },
    });
    const r = await request(app.getHttpServer())
      .get(`/balances/${employeeId2}`)
      .set('x-employee-id', managerId).set('x-role', Role.MANAGER)
      .expect(200);
    expect(r.body[0].employeeId).toBe(employeeId2);
  });

  it('rejects with 401 when x-employee-id is missing', async () => {
    await request(app.getHttpServer())
      .get(`/balances/${employeeId1}`)
      .expect(401);
  });
});
