import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OutboxRepository } from './outbox.repository';

export const OUTBOX_QUEUE = Symbol('OUTBOX_QUEUE');

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repo: OutboxRepository,
    @Inject(OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    if (process.env.OUTBOX_POLL_DISABLED === '1') return;
    const intervalMs = Number(process.env.OUTBOX_POLL_MS ?? 500);
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Public for testability: run one polling iteration. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await this.repo.claimBatch(50);
      for (const e of claimed) {
        await this.queue.add(
          e.eventType,
          { outboxId: e.id, aggregateId: e.aggregateId, payload: e.payload },
          { jobId: e.id, removeOnComplete: 1000, removeOnFail: false },
        );
      }
    } catch (err) {
      this.log.error('outbox tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
