import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../../src/modules/hcm-client/hcm.port';
import { ReserveHcmProcessor } from '../../../src/workers/reserve-hcm.processor';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { SagaState, RequestStatus, MovementType } from '@examplehr/contracts';
import { INestApplication } from '@nestjs/common';

const fakeJob = (data: any) => ({ name: 'RESERVE_HCM', data } as any);

describe('ReserveHcmProcessor (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let proc: ReserveHcmProcessor;
  let hcm: HcmInMemoryAdapter;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
    proc = app.get(ReserveHcmProcessor);
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

  it('progresses to AWAITING_APPROVAL on HCM success', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03'),
      idempotencyKey: 'k1',
    });
    await proc.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '3', reservationId: r.id },
      outboxId: 'o',
    }));
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.sagaState).toBe(SagaState.AWAITING_APPROVAL);
    expect(updated?.status).toBe(RequestStatus.PENDING_APPROVAL);
  });

  it('fails request and releases reservation on HCM 4xx', async () => {
    hcm.injectFailure({ op: 'reserve', kind: 'insufficient' });
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k2',
    });
    await proc.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }));
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.FAILED);
    expect(updated?.sagaState).toBe(SagaState.TERMINAL);
    const ms = await prisma.timeOffMovement.findMany({
      where: { requestId: r.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ms.map((m) => m.type)).toEqual([MovementType.PENDING_RESERVATION, MovementType.CANCELLED]);
  });

  it('rethrows on HCM 5xx so BullMQ retries', async () => {
    hcm.injectFailure({ op: 'reserve', kind: 'unavailable' });
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k3',
    });
    await expect(proc.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }))).rejects.toMatchObject({ code: 'HCM_UNAVAILABLE' });
    // Request stays in RESERVING_HCM (waiting for retry)
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.sagaState).toBe(SagaState.RESERVING_HCM);
  });

  it('no-op when request not in RESERVING_HCM', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k4',
    });
    // Manually move to TERMINAL
    await prisma.timeOffRequest.update({
      where: { id: r.id },
      data: { sagaState: SagaState.TERMINAL, status: RequestStatus.FAILED },
    });
    await proc.process(fakeJob({
      aggregateId: r.id,
      payload: { employeeId: 'e1', locationId: 'l1', days: '1', reservationId: r.id },
      outboxId: 'o',
    }));
    // Should not throw, should not re-trigger HCM (no movement added)
    const ms = await prisma.timeOffMovement.findMany({ where: { requestId: r.id } });
    expect(ms).toHaveLength(1); // only the original PENDING_RESERVATION
  });
});
