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

  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.timeOffMovement.deleteMany();
    await prisma.balance.deleteMany();
  });

  it('returns derived available = total - reserved', async () => {
    await prisma.balance.create({ data: { employeeId: 'e1', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 } });
    await prisma.timeOffMovement.create({ data: { employeeId: 'e1', locationId: 'l1', delta: '-3', type: MovementType.PENDING_RESERVATION } });
    const r = await request(app.getHttpServer())
      .get('/balances/e1')
      .set('x-employee-id', 'e1').set('x-role', Role.EMPLOYEE)
      .expect(200);
    expect(r.body[0]).toMatchObject({ employeeId: 'e1', locationId: 'l1', totalDays: '10', availableDays: '7' });
  });

  it('rejects when employee tries to read another employee', async () => {
    await request(app.getHttpServer())
      .get('/balances/e2')
      .set('x-employee-id', 'e1').set('x-role', Role.EMPLOYEE)
      .expect(403);
  });

  it('manager can read any employee', async () => {
    await prisma.balance.create({ data: { employeeId: 'e2', locationId: 'l1', totalDays: '5', hcmLastSeenAt: new Date(), version: 1 } });
    const r = await request(app.getHttpServer())
      .get('/balances/e2')
      .set('x-employee-id', 'm1').set('x-role', Role.MANAGER)
      .expect(200);
    expect(r.body[0].employeeId).toBe('e2');
  });

  it('rejects with 401 when x-employee-id is missing', async () => {
    await request(app.getHttpServer())
      .get('/balances/e1')
      .expect(401);
  });
});
