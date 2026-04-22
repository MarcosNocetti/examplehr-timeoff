import { BalanceRepository } from '../../../src/modules/balances/balance.repository';
import { createTestDb, TestDb } from '../../helpers/prisma-test';
import Decimal from 'decimal.js';

describe('BalanceRepository (integration)', () => {
  let db: TestDb;
  let repo: BalanceRepository;

  beforeEach(async () => {
    db = createTestDb();
    repo = new BalanceRepository(db.client as any);
  });
  afterEach(async () => db.cleanup());

  it('upserts balance and increments version', async () => {
    await repo.upsertFromHcm({ employeeId: 'e1', locationId: 'l1', totalDays: new Decimal(10), hcmTimestamp: new Date('2026-01-01') });
    const v1 = await repo.findOne('e1', 'l1');
    expect(v1?.version).toBe(1);

    await repo.upsertFromHcm({ employeeId: 'e1', locationId: 'l1', totalDays: new Decimal(15), hcmTimestamp: new Date('2026-04-22') });
    const v2 = await repo.findOne('e1', 'l1');
    expect(v2?.version).toBe(2);
    expect(v2?.totalDays.toString()).toBe('15');
  });

  it('skips upsert when incoming hcmTimestamp is older', async () => {
    await repo.upsertFromHcm({ employeeId: 'e1', locationId: 'l1', totalDays: new Decimal(10), hcmTimestamp: new Date('2026-04-22') });
    const skipped = await repo.upsertFromHcm({ employeeId: 'e1', locationId: 'l1', totalDays: new Decimal(99), hcmTimestamp: new Date('2026-01-01') });
    expect(skipped).toBe('SKIPPED_STALE');
    const v = await repo.findOne('e1', 'l1');
    expect(v?.totalDays.toString()).toBe('10');
  });
});
