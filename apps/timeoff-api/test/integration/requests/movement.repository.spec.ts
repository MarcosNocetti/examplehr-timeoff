import { MovementRepository } from '../../../src/modules/requests/movement.repository';
import { createTestDb, TestDb } from '../../helpers/prisma-test';
import { MovementType } from '@examplehr/contracts';
import Decimal from 'decimal.js';

describe('MovementRepository (integration)', () => {
  let db: TestDb;
  let repo: MovementRepository;
  beforeEach(async () => { db = createTestDb(); repo = new MovementRepository(db.client as any); });
  afterEach(async () => db.cleanup());

  it('lists movements by employee and location', async () => {
    await repo.create({ employeeId: 'e1', locationId: 'l1', delta: new Decimal(-3), type: MovementType.PENDING_RESERVATION, requestId: 'r1' });
    await repo.create({ employeeId: 'e1', locationId: 'l1', delta: new Decimal(-1), type: MovementType.CONFIRMED, requestId: 'r2' });
    await repo.create({ employeeId: 'e1', locationId: 'l2', delta: new Decimal(-9), type: MovementType.PENDING_RESERVATION, requestId: 'r3' });
    const ms = await repo.listForBalance('e1', 'l1');
    expect(ms).toHaveLength(2);
    expect(ms.map((m) => m.delta.toString()).sort()).toEqual(['-1', '-3']);
  });
});
