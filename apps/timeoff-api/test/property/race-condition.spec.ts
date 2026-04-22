import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RequestsService } from '../../src/modules/requests/requests.service';
import { INestApplication } from '@nestjs/common';

describe('Race condition (T-1)', () => {
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

  it('50 concurrent requests of 1 day each on balance=10 → exactly 10 succeed, 40 fail with INSUFFICIENT_BALANCE, no negative ledger', async () => {
    await prisma.outboxEntry.deleteMany();
    await prisma.timeOffMovement.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.balance.create({
      data: { employeeId: 'e1', locationId: 'l1', totalDays: '10', hcmLastSeenAt: new Date(), version: 1 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        svc.create({
          employeeId: 'e1',
          locationId: 'l1',
          startDate: new Date('2026-05-01'),
          endDate: new Date('2026-05-01'),
          idempotencyKey: `k-${i}`,
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    // Each failure should be INSUFFICIENT_BALANCE
    for (const f of failed) {
      expect((f.reason as any).code).toBe('INSUFFICIENT_BALANCE');
    }

    // Exactly 10 succeed, 40 fail
    expect(succeeded).toHaveLength(10);
    expect(failed).toHaveLength(40);

    // Sum of pending reservations must equal -10 (not less, not more)
    const reservationMovements = await prisma.timeOffMovement.findMany({
      where: { employeeId: 'e1', locationId: 'l1', type: 'PENDING_RESERVATION' },
    });
    expect(reservationMovements).toHaveLength(10);
    const sum = reservationMovements.reduce((acc, m) => acc + Number(m.delta), 0);
    expect(sum).toBe(-10);

    // Verify no double-write on idempotencyKey
    const requests = await prisma.timeOffRequest.findMany({ where: { employeeId: 'e1' } });
    expect(requests).toHaveLength(10);
    const uniqueKeys = new Set(requests.map((r) => r.idempotencyKey));
    expect(uniqueKeys.size).toBe(10);
  }, 60000);
});
