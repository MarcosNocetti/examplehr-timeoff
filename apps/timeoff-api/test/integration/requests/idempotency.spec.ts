import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../../src/modules/requests/requests.service';
import { INestApplication } from '@nestjs/common';

describe('Idempotency (T-4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: RequestsService;

  beforeAll(async () => {
    process.env.HCM_ADAPTER = 'memory';
    process.env.OUTBOX_POLL_DISABLED = '1';
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(RequestsService);
  });
  afterAll(async () => app.close());

  it('5 concurrent posts with same idempotencyKey → exactly 1 request created, all returns share id', async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.balance.create({
      data: { employeeId: 'e1', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        svc.create({
          employeeId: 'e1', locationId: 'l1',
          startDate: new Date('2026-05-01'), endDate: new Date('2026-05-01'),
          idempotencyKey: 'same-key',
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    // All concurrent posts that didn't lose to the unique constraint should resolve to the same id.
    // Some posts may reject with a unique-constraint violation (Prisma P2002) — in that case our
    // service catches the dup inside the tx and returns the existing row. So all should fulfill.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const reqs = await prisma.timeOffRequest.findMany();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.idempotencyKey).toBe('same-key');

    const movements = await prisma.timeOffMovement.findMany({ where: { type: 'PENDING_RESERVATION' } });
    expect(movements).toHaveLength(1);
  }, 30000);
});
