import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { ReconciliationService } from '../../../src/modules/reconciliation/reconciliation.service';
import { BalancesService } from '../../../src/modules/balances/balances.service';
import { HcmSagaProcessor } from '../../../src/workers/hcm-saga.processor';
import { HcmInMemoryAdapter } from '../../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../../src/modules/hcm-client/hcm.port';
import { INestApplication } from '@nestjs/common';

describe('Drift survival (T-2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let recon: ReconciliationService;
  let balances: BalancesService;
  let reserve: HcmSagaProcessor;
  let hcm: HcmInMemoryAdapter;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
    recon = app.get(ReconciliationService);
    balances = app.get(BalancesService);
    reserve = app.get(HcmSagaProcessor);
    hcm = app.get(HCM_PORT) as HcmInMemoryAdapter;
  });

  afterAll(async () => app.close());

  it('reservation survives HCM batch refresh that increases total', async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    hcm.reset();
    hcm.seed('e1', 'l1', '10');
    await prisma.balance.create({
      data: {
        employeeId: 'e1', locationId: 'l1',
        totalDays: '10',
        hcmLastSeenAt: new Date(2026, 0, 1),
        version: 1,
      },
    });

    // 1) Employee creates request for 5 days
    const r = await svc.create({
      employeeId: 'e1', locationId: 'l1',
      startDate: new Date('2026-05-01'), endDate: new Date('2026-05-05'),
      idempotencyKey: 'k1',
    });

    // 2) Reserve worker runs → AWAITING_APPROVAL
    await reserve.process({
      name: 'RESERVE_HCM',
      data: {
        aggregateId: r.id,
        payload: { employeeId: 'e1', locationId: 'l1', days: '5', reservationId: r.id },
        outboxId: 'o',
      },
    } as any);

    // 3) HCM refreshes balance to 15 (work anniversary, fresh timestamp)
    await recon.applyRealtime({
      employeeId: 'e1', locationId: 'l1',
      newTotal: '15',
      hcmTimestamp: new Date(2026, 4, 22).toISOString(),
    });

    // 4) Available = 15 - 5 = 10; request still in AWAITING_APPROVAL
    const updated = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
    expect(updated?.status).toBe('PENDING_APPROVAL');

    const dto = await balances.listForEmployee('e1');
    expect(dto[0]?.totalDays).toBe('15');
    expect(dto[0]?.availableDays).toBe('10');
  });
});
