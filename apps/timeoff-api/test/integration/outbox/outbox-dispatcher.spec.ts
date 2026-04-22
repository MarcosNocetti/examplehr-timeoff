import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { OutboxModule } from '../../../src/modules/outbox/outbox.module';
import { OutboxRepository } from '../../../src/modules/outbox/outbox.repository';
import { OUTBOX_QUEUE, OutboxDispatcher } from '../../../src/modules/outbox/outbox-dispatcher';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { PrismaModule } from '../../../src/shared/prisma/prisma.module';
import { createTestDb } from '../../helpers/prisma-test';

// Lightweight queue stub — avoids ioredis-mock Lua-script incompatibilities with BullMQ v5.
interface JobRecord { name: string; data: unknown; opts: { jobId: string } }
function makeFakeQueue() {
  const jobs: JobRecord[] = [];
  return {
    add: jest.fn(async (name: string, data: unknown, opts: { jobId: string }) => {
      // Idempotency: only add if jobId not already present
      if (!jobs.some((j) => j.opts.jobId === opts.jobId)) {
        jobs.push({ name, data, opts });
      }
    }),
    close: jest.fn(async () => undefined),
    jobs,
  };
}

describe('OutboxDispatcher (integration)', () => {
  beforeAll(() => {
    process.env.OUTBOX_POLL_DISABLED = '1';
  });

  it('claims pending entries and pushes to BullMQ queue', async () => {
    const db = createTestDb();
    const fakeQueue = makeFakeQueue();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, OutboxModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .overrideProvider(OUTBOX_QUEUE)
      .useValue(fakeQueue)
      .compile();

    await moduleRef.init();
    try {
      const repo = moduleRef.get(OutboxRepository);
      const dispatcher = moduleRef.get(OutboxDispatcher);

      await repo.create({ aggregateId: 'r1', eventType: 'RESERVE_HCM', payload: { foo: 'bar' } });
      await dispatcher.tick();

      expect(fakeQueue.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = (fakeQueue.add as jest.Mock).mock.calls[0]!;
      expect(name).toBe('RESERVE_HCM');
      expect((data as any).aggregateId).toBe('r1');
      expect((data as any).payload).toEqual({ foo: 'bar' });
      expect(typeof opts.jobId).toBe('string');
    } finally {
      await moduleRef.close();
      await db.cleanup();
    }
  });

  it('is idempotent: a second tick with no new entries does not add more jobs', async () => {
    const db = createTestDb();
    const fakeQueue = makeFakeQueue();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, OutboxModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .overrideProvider(OUTBOX_QUEUE)
      .useValue(fakeQueue)
      .compile();

    await moduleRef.init();
    try {
      const repo = moduleRef.get(OutboxRepository);
      const dispatcher = moduleRef.get(OutboxDispatcher);

      await repo.create({ aggregateId: 'r2', eventType: 'RESERVE_HCM', payload: { x: 1 } });
      // First tick claims and dispatches the entry
      await dispatcher.tick();
      // Second tick finds nothing PENDING (already DISPATCHED)
      await dispatcher.tick();

      expect(fakeQueue.add).toHaveBeenCalledTimes(1);
    } finally {
      await moduleRef.close();
      await db.cleanup();
    }
  });

  it('uses outbox entry id as BullMQ jobId for idempotency', async () => {
    const db = createTestDb();
    const fakeQueue = makeFakeQueue();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, OutboxModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .overrideProvider(OUTBOX_QUEUE)
      .useValue(fakeQueue)
      .compile();

    await moduleRef.init();
    try {
      const repo = moduleRef.get(OutboxRepository);
      const dispatcher = moduleRef.get(OutboxDispatcher);

      const entry = await repo.create({ aggregateId: 'r3', eventType: 'APPROVE_HCM', payload: {} });
      await dispatcher.tick();

      const [, , opts] = (fakeQueue.add as jest.Mock).mock.calls[0]!;
      expect(opts.jobId).toBe(entry.id);
    } finally {
      await moduleRef.close();
      await db.cleanup();
    }
  });
});
