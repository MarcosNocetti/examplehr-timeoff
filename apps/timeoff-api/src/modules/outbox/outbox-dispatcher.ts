import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OutboxRepository } from './outbox.repository';

export const OUTBOX_QUEUE = Symbol('OUTBOX_QUEUE');

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private reaperTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repo: OutboxRepository,
    @Inject(OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    // The dispatcher only runs on the worker container. The api container and
    // tests both lack ROLE=worker so the timers never start there — this
    // avoids log spam from tests hitting a DB without the OutboxEntry table
    // and prevents two pollers racing on the same SQLite file.
    // OUTBOX_POLL_DISABLED=1 also short-circuits for tests that want to
    // drive tick() manually.
    if (process.env.OUTBOX_POLL_DISABLED === '1') return;
    if (process.env.ROLE !== 'worker') return;

    const intervalMs = Number(process.env.OUTBOX_POLL_MS ?? 500);
    this.timer = setInterval(() => void this.tick(), intervalMs);

    const reapMs = Number(process.env.OUTBOX_REAP_MS ?? 60_000);        // run every 1 min
    const reapStuckForMs = Number(process.env.OUTBOX_STUCK_MS ?? 300_000); // re-arm after 5 min
    this.reaperTimer = setInterval(() => void this.reap(reapStuckForMs), reapMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  /** Reaper: re-arm DISPATCHED entries stuck longer than stuckForMs. */
  async reap(stuckForMs: number): Promise<void> {
    try {
      const count = await this.repo.reapStuckDispatched(stuckForMs);
      if (count > 0) this.log.warn({ count, stuckForMs }, 'Re-armed stuck DISPATCHED outbox entries');
    } catch (err) {
      this.log.error('outbox reap failed', err as Error);
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
