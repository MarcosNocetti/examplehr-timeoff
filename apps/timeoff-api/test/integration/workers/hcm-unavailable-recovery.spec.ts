import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../../src/modules/hcm-client/hcm.port';
import { HcmSagaProcessor } from '../../../src/workers/hcm-saga.processor';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { SagaState, RequestStatus } from '@examplehr/contracts';
import { INestApplication } from '@nestjs/common';

const fakeJob = (data: any) => ({ name: 'RESERVE_HCM', data } as any);

describe('HCM unavailable then recovers (T-3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let saga: HcmSagaProcessor;
  let hcm: HcmInMemoryAdapter;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    delete process.env.ROLE; // ensure HcmSagaProcessor doesn't no-op
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
    saga = app.get(HcmSagaProcessor);
    hcm = app.get(HCM_PORT) as HcmInMemoryAdapter;
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    hcm.reset();
    hcm.seed('e1', 'l1', '10');
    await prisma.balance.create({
      data: { employeeId: 'e1', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });
  });

  it('on HCM 5xx the request stays RESERVING_HCM (worker rethrows for BullMQ retry)', async () => {
    hcm.injectFailure({ op: 'reserve', kind: 'unavailable' });
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 't3-1',
    });

    await expect(saga.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }))).rejects.toMatchObject({ code: 'HCM_UNAVAILABLE' });

    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.sagaState).toBe(SagaState.RESERVING_HCM);
    expect(updated?.status).toBe(RequestStatus.PENDING_APPROVAL);
  });

  it('after HCM recovers, the same request can progress to AWAITING_APPROVAL on retry', async () => {
    // 1) HCM is down — first attempt fails
    hcm.injectFailure({ op: 'reserve', kind: 'unavailable' });
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 't3-2',
    });
    await expect(saga.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }))).rejects.toMatchObject({ code: 'HCM_UNAVAILABLE' });

    // Confirm still in RESERVING_HCM
    let snapshot = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(snapshot?.sagaState).toBe(SagaState.RESERVING_HCM);

    // 2) HCM recovers (no more failure injected) — retry the same job
    await saga.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }));

    // 3) Now AWAITING_APPROVAL
    snapshot = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(snapshot?.sagaState).toBe(SagaState.AWAITING_APPROVAL);
    expect(snapshot?.status).toBe(RequestStatus.PENDING_APPROVAL);
  });
});
