import fc from 'fast-check';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../src/modules/requests/requests.service';
import { ReserveHcmProcessor } from '../../src/workers/reserve-hcm.processor';
import { ConfirmHcmProcessor } from '../../src/workers/confirm-hcm.processor';
import { CompensateHcmProcessor } from '../../src/workers/compensate-hcm.processor';
import { HcmInMemoryAdapter } from '../../src/modules/hcm-client/hcm-in-memory.adapter';
import { HCM_PORT } from '../../src/modules/hcm-client/hcm.port';
import { BalancesService } from '../../src/modules/balances/balances.service';
import { ReconciliationService } from '../../src/modules/reconciliation/reconciliation.service';
import { INestApplication } from '@nestjs/common';

const Action = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), days: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant('approve' as const) }),
  fc.record({ kind: fc.constant('reject' as const) }),
  fc.record({ kind: fc.constant('cancel' as const) }),
  fc.record({ kind: fc.constant('refresh' as const), newTotal: fc.integer({ min: 0, max: 30 }) }),
);

/** Tracks a pending request waiting for approval together with its actual days value. */
interface PendingEntry {
  id: string;
  days: string;
}

describe('Available balance invariant (property)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;
  let balances: BalancesService;
  let recon: ReconciliationService;
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
    balances = app.get(BalancesService);
    recon = app.get(ReconciliationService);
    reserve = app.get(ReserveHcmProcessor);
    confirm = app.get(ConfirmHcmProcessor);
    compensate = app.get(CompensateHcmProcessor);
    hcm = app.get(HCM_PORT) as HcmInMemoryAdapter;
  });

  afterAll(async () => app.close());

  it('available days never goes negative regardless of action sequence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(Action, { minLength: 1, maxLength: 20 }), async (actions) => {
        // Reset state per property iteration
        await prisma.outboxEntry.deleteMany();
        await prisma.timeOffMovement.deleteMany();
        await prisma.timeOffRequest.deleteMany();
        await prisma.balance.deleteMany();
        hcm.reset();
        hcm.seed('e1', 'l1', '20');
        await prisma.balance.create({
          data: {
            employeeId: 'e1', locationId: 'l1',
            totalDays: '20',
            hcmLastSeenAt: new Date(2026, 0, 1),
            version: 1,
          },
        });

        // Track (id, days) pairs so confirm/compensate use the correct days amount.
        const pendingApprovalEntries: PendingEntry[] = [];
        let i = 0;
        for (const a of actions) {
          try {
            switch (a.kind) {
              case 'create': {
                const r = await svc.create({
                  employeeId: 'e1', locationId: 'l1',
                  startDate: new Date('2026-05-01'),
                  endDate: new Date(2026, 4, a.days),
                  idempotencyKey: `k${i++}`,
                });
                await reserve.process({
                  name: 'RESERVE_HCM',
                  data: {
                    aggregateId: r.id,
                    payload: { employeeId: 'e1', locationId: 'l1', days: a.days.toString(), reservationId: r.id },
                    outboxId: 'o',
                  },
                } as any);
                // After reserve, only add to pending if the saga reached AWAITING_APPROVAL.
                const fresh = await prisma.timeOffRequest.findUnique({ where: { id: r.id } });
                if (fresh?.sagaState === 'AWAITING_APPROVAL') {
                  pendingApprovalEntries.push({ id: r.id, days: a.days.toString() });
                }
                break;
              }
              case 'approve': {
                const entry = pendingApprovalEntries.shift();
                if (!entry) break;
                await svc.approve(entry.id);
                await confirm.process({
                  name: 'CONFIRM_HCM',
                  data: {
                    aggregateId: entry.id,
                    payload: { reservationId: entry.id, employeeId: 'e1', locationId: 'l1', days: entry.days },
                  },
                } as any);
                break;
              }
              case 'reject':
              case 'cancel': {
                const entry = pendingApprovalEntries.shift();
                if (!entry) break;
                if (a.kind === 'reject') await svc.reject(entry.id);
                else await svc.cancel(entry.id);
                await compensate.process({
                  name: 'COMPENSATE_HCM',
                  data: {
                    aggregateId: entry.id,
                    payload: { reservationId: entry.id, employeeId: 'e1', locationId: 'l1', days: entry.days },
                  },
                } as any);
                break;
              }
              case 'refresh': {
                await recon.applyRealtime({
                  employeeId: 'e1', locationId: 'l1',
                  newTotal: a.newTotal.toString(),
                  hcmTimestamp: new Date(2026, 4, ++i).toISOString(),
                });
                break;
              }
            }
          } catch {
            // Errors are expected (insufficient balance, invalid transition); the invariant must still hold.
          }

          const dto = await balances.listForEmployee('e1');
          const available = Number(dto[0]?.availableDays ?? '0');
          if (available < 0) {
            throw new Error(`Invariant violated after action ${a.kind}: availableDays=${available}`);
          }
        }
      }),
      { numRuns: 15, timeout: 60000, verbose: true },
    );
  }, 180000);
});
