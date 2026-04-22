import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../../src/modules/hcm-client/hcm.port';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { ReserveHcmProcessor } from '../../../src/workers/reserve-hcm.processor';
import { ConfirmHcmProcessor } from '../../../src/workers/confirm-hcm.processor';
import { CompensateHcmProcessor } from '../../../src/workers/compensate-hcm.processor';
import { RequestStatus, SagaState, MovementType } from '@examplehr/contracts';
import { INestApplication } from '@nestjs/common';

const fakeJob = (name: string, data: any) => ({ name, data } as any);

describe('Approval lifecycle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let reserve: ReserveHcmProcessor;
  let confirm: ConfirmHcmProcessor;
  let compensate: CompensateHcmProcessor;
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
    confirm = app.get(ConfirmHcmProcessor);
    compensate = app.get(CompensateHcmProcessor);
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

  async function runReserveJob(reqId: string, days: string) {
    await reserve.process(fakeJob('RESERVE_HCM', {
      aggregateId: reqId,
      payload: { employeeId: 'e1', locationId: 'l1', days, reservationId: reqId },
      outboxId: 'o',
    }));
  }

  it('approve path consumes balance', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03'),
      idempotencyKey: 'k1',
    });
    await runReserveJob(r.id, '3');
    await svc.approve(r.id);
    await confirm.process(fakeJob('CONFIRM_HCM', {
      aggregateId: r.id,
      payload: { reservationId: r.id, employeeId: 'e1', locationId: 'l1', days: '3' },
    }));

    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.APPROVED);
    expect(updated?.sagaState).toBe(SagaState.TERMINAL);

    const ms = await prisma.timeOffMovement.findMany({
      where: { requestId: r.id },
      orderBy: { createdAt: 'asc' },
    });
    // Order: PENDING_RESERVATION(-3), CONFIRMED(-3), CANCELLED(+3 to offset pending)
    expect(ms.map((m) => m.type)).toEqual([
      MovementType.PENDING_RESERVATION,
      MovementType.CONFIRMED,
      MovementType.CANCELLED,
    ]);
  });

  it('reject path releases reservation', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03'),
      idempotencyKey: 'k2',
    });
    await runReserveJob(r.id, '3');
    await svc.reject(r.id, 'no');
    await compensate.process(fakeJob('COMPENSATE_HCM', {
      aggregateId: r.id,
      payload: {
        reservationId: r.id, employeeId: 'e1', locationId: 'l1', days: '3',
        intendedTerminalStatus: RequestStatus.REJECTED,
      },
    }));

    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.REJECTED);
    expect(updated?.sagaState).toBe(SagaState.TERMINAL);

    // PENDING_RESERVATION(-3) + CANCELLED(+3) = available restored fully
    const ms = await prisma.timeOffMovement.findMany({ where: { requestId: r.id } });
    expect(ms.map((m) => m.type).sort()).toEqual([
      MovementType.CANCELLED,
      MovementType.PENDING_RESERVATION,
    ].sort());
  });

  it('cancel path produces CANCELLED status', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k3',
    });
    await runReserveJob(r.id, '1');
    await svc.cancel(r.id);
    await compensate.process(fakeJob('COMPENSATE_HCM', {
      aggregateId: r.id,
      payload: {
        reservationId: r.id, employeeId: 'e1', locationId: 'l1', days: '1',
        intendedTerminalStatus: RequestStatus.CANCELLED,
      },
    }));

    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.CANCELLED);
  });

  it('approve from non-AWAITING_APPROVAL throws InvalidStateTransitionError', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k4',
    });
    // Don't run the reserve job — request still in RESERVING_HCM
    await expect(svc.approve(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('forceFail releases reservation + marks FAILED', async () => {
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
      idempotencyKey: 'k5',
    });
    await svc.forceFail(r.id, 'manual recovery');

    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe(RequestStatus.FAILED);
    expect(updated?.sagaState).toBe(SagaState.TERMINAL);

    // Should have released via CANCELLED movement
    const ms = await prisma.timeOffMovement.findMany({ where: { requestId: r.id } });
    const types = ms.map((m) => m.type).sort();
    expect(types).toContain(MovementType.CANCELLED);
  });
});
