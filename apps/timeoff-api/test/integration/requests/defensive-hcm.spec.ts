import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { ReserveHcmProcessor } from '../../../src/workers/reserve-hcm.processor';
import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../../src/modules/hcm-client/hcm.port';
import { INestApplication } from '@nestjs/common';

describe('Defensive HCM (T-6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let reserve: ReserveHcmProcessor;
  let hcm: HcmInMemoryAdapter;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
    reserve = app.get(ReserveHcmProcessor);
    hcm = app.get(HCM_PORT) as HcmInMemoryAdapter;
  });
  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    hcm.reset();
  });

  it('catches HCM_PROTOCOL_VIOLATION when HCM accepts but local invariant fails', async () => {
    // Setup: balance=5 in DB. Seed HCM with same.
    hcm.seed('e1', 'l1', '5');
    await prisma.balance.create({
      data: { employeeId: 'e1', locationId: 'l1', totalDays: '5', hcmLastSeenAt: new Date(), version: 1 },
    });

    // Step 1: create a normal request that consumes 1 day (writes PENDING_RESERVATION -1).
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'def-1',
    });

    // Step 2: simulate an out-of-band PENDING_RESERVATION (e.g., a corrupted state)
    // that brings local available below 0 once the saga tries to add another reserve.
    // We inject a phantom -10 movement, simulating the situation where HCM accepted
    // a reservation but the local ledger says we shouldn't have.
    await prisma.timeOffMovement.create({
      data: { employeeId: 'e1', locationId: 'l1', delta: '-10', type: 'PENDING_RESERVATION' },
    });

    // Step 3: tell HCM to silently accept (even though it should reject) on the next reserve.
    hcm.injectFailure({ op: 'reserve', kind: 'silent_accept' });

    // Step 4: process the original request's RESERVE_HCM job.
    // HCM will accept (silent), but the defensive guard sees available < 0 and throws.
    await expect(
      reserve.process({
        name: 'RESERVE_HCM',
        data: {
          aggregateId: r.id,
          payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
          outboxId: 'o',
        },
      } as any),
    ).rejects.toMatchObject({ code: 'HCM_PROTOCOL_VIOLATION' });

    // The request stays in RESERVING_HCM (the throw causes BullMQ to retry; in DLQ ops would
    // call force-fail to terminate cleanly).
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.sagaState).toBe('RESERVING_HCM');
  }, 15000);
});
