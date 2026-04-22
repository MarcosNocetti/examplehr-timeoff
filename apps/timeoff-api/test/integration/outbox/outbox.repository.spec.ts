import { OutboxRepository } from '../../../src/modules/outbox/outbox.repository';
import { createTestDb, TestDb } from '../../helpers/prisma-test';

describe('OutboxRepository (integration)', () => {
  let db: TestDb;
  let repo: OutboxRepository;

  beforeEach(async () => { db = createTestDb(); repo = new OutboxRepository(db.client as any); });
  afterEach(async () => db.cleanup());

  it('claims pending entries atomically and skips already-dispatched', async () => {
    await repo.create({ aggregateId: 'r1', eventType: 'RESERVE_HCM', payload: { x: 1 } });
    await repo.create({ aggregateId: 'r2', eventType: 'RESERVE_HCM', payload: { x: 2 } });
    const claimed1 = await repo.claimBatch(10);
    expect(claimed1).toHaveLength(2);
    const claimed2 = await repo.claimBatch(10);
    expect(claimed2).toHaveLength(0);
  });

  it('reschedules with backoff on failure', async () => {
    await repo.create({ aggregateId: 'r1', eventType: 'RESERVE_HCM', payload: { x: 1 } });
    const claimed = await repo.claimBatch(10);
    const c = claimed[0]!;
    await repo.fail(c.id, 'boom');
    const updated = await repo.findById(c.id);
    expect(updated?.attempts).toBe(1);
    expect(updated?.status).toBe('PENDING');
    expect(updated?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 500);
  });

  it('moves to DEAD after 5 attempts', async () => {
    await repo.create({ aggregateId: 'r1', eventType: 'RESERVE_HCM', payload: {} });
    const [c] = await repo.claimBatch(10);
    for (let i = 0; i < 5; i++) await repo.fail(c!.id, 'boom');
    const updated = await repo.findById(c!.id);
    expect(updated?.status).toBe('DEAD');
  });

  it('claim respects nextAttemptAt (does not pick up rescheduled until due)', async () => {
    await repo.create({ aggregateId: 'r1', eventType: 'RESERVE_HCM', payload: {} });
    const [c] = await repo.claimBatch(10);
    await repo.fail(c!.id, 'boom'); // reschedules into the future
    const claimedAgain = await repo.claimBatch(10);
    expect(claimedAgain).toHaveLength(0);
  });
});
