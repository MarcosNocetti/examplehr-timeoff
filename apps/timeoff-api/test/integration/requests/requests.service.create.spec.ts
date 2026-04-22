import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { MovementType, SagaState } from '@examplehr/contracts';
import { INestApplication } from '@nestjs/common';

describe('RequestsService.create (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;

  beforeAll(async () => {
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
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

  it('creates request, PENDING_RESERVATION movement, and RESERVE_HCM outbox in one transaction', async () => {
    const r = await svc.create({
      employeeId: 'e1',
      locationId: 'l1',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-03'),
      idempotencyKey: 'k1',
    });
    expect(r.sagaState).toBe(SagaState.RESERVING_HCM);
    const movements = await prisma.timeOffMovement.findMany({ where: { requestId: r.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe(MovementType.PENDING_RESERVATION);
    expect(movements[0]?.delta.toString()).toBe('-3');
    const outbox = await prisma.outboxEntry.findMany();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe('RESERVE_HCM');
    const payload = JSON.parse(outbox[0]!.payload);
    expect(payload).toMatchObject({ employeeId: 'e1', locationId: 'l1', days: '3', reservationId: r.id });
  });

  it('rejects with INSUFFICIENT_BALANCE without writing anything', async () => {
    await expect(
      svc.create({
        employeeId: 'e1',
        locationId: 'l1',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-30'),
        idempotencyKey: 'k2',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await prisma.timeOffRequest.findMany()).toHaveLength(0);
    expect(await prisma.outboxEntry.findMany()).toHaveLength(0);
    expect(await prisma.timeOffMovement.findMany()).toHaveLength(0);
  });

  it('returns existing request on duplicate idempotencyKey', async () => {
    const r1 = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k3',
    });
    const r2 = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k3',
    });
    expect(r1.id).toBe(r2.id);
    expect(await prisma.timeOffRequest.findMany()).toHaveLength(1);
  });

  it('rejects with NOT_FOUND when no balance exists', async () => {
    await prisma.balance.deleteMany();
    await expect(
      svc.create({
        employeeId: 'eX', locationId: 'lX',
        startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
        idempotencyKey: 'k4',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
