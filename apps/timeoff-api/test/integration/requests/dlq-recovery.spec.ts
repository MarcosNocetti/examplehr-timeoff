import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { OutboxRepository } from '../../../src/modules/outbox/outbox.repository';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { BalancesService } from '../../../src/modules/balances/balances.service';
import { SagaState, RequestStatus, MovementType } from '@examplehr/contracts';
import { INestApplication } from '@nestjs/common';

describe('DLQ recovery via force-fail (T-5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let balances: BalancesService;
  let outbox: OutboxRepository;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    delete process.env.ROLE;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
    balances = app.get(BalancesService);
    outbox = app.get(OutboxRepository);
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

  it('after MAX_ATTEMPTS failures the outbox entry transitions to DEAD', async () => {
    // Create the entry directly (skip the saga setup)
    const entry = await outbox.create({
      aggregateId: 'fake-request-id',
      eventType: 'RESERVE_HCM',
      payload: { foo: 'bar' },
    });

    // Simulate 5 worker failures
    for (let i = 0; i < 5; i++) {
      await outbox.fail(entry.id, `attempt ${i + 1} boom`);
    }

    const dead = await outbox.findById(entry.id);
    expect(dead?.status).toBe('DEAD');
    expect(dead?.attempts).toBe(5);
    expect(dead?.lastError).toContain('attempt 5');
  });

  it('admin force-fail releases reservation and marks request FAILED', async () => {
    // Create a real request that has a PENDING_RESERVATION movement.
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03'),
      idempotencyKey: 't5-1',
    });

    // Sanity: balance shows 7 available (10 total - 3 from PENDING_RESERVATION)
    const beforeForceFail = await balances.listForEmployee('e1');
    expect(beforeForceFail[0]?.availableDays).toBe('7');

    // Operator decides to force-fail the stuck request
    await svc.forceFail(r.id, 'manual recovery — HCM unrecoverable');

    // Request is FAILED + TERMINAL
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.FAILED);
    expect(updated?.sagaState).toBe(SagaState.TERMINAL);

    // Balance is fully restored: CANCELLED(+3) is in RESERVATION_TYPES and
    // offsets the original PENDING_RESERVATION(-3). totalDays is unchanged
    // since HCM was never confirmed.
    const afterForceFail = await balances.listForEmployee('e1');
    expect(afterForceFail[0]?.availableDays).toBe('10');

    // Ledger trail: PENDING_RESERVATION(-3) + CANCELLED(+3) net to zero
    const ms = await prisma.timeOffMovement.findMany({
      where: { requestId: r.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ms.map((m) => m.type)).toEqual([
      MovementType.PENDING_RESERVATION,
      MovementType.CANCELLED,
    ]);
  });
});
