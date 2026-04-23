import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

const BACKOFF_MS = [1000, 5000, 25000, 120000, 600000]; // 1s, 5s, 25s, 2min, 10min
const MAX_ATTEMPTS = 5;

export type OutboxStatus = 'PENDING' | 'DISPATCHED' | 'FAILED' | 'DEAD';

export interface OutboxRow {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { aggregateId: string; eventType: string; payload: unknown; tx?: any }): Promise<OutboxRow> {
    const client = input.tx ?? this.prisma;
    const r = await client.outboxEntry.create({
      data: {
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: JSON.stringify(input.payload),
        status: 'PENDING',
      },
    });
    return this.toRow(r);
  }

  async findById(id: string): Promise<OutboxRow | null> {
    const r = await this.prisma.outboxEntry.findUnique({ where: { id } });
    return r ? this.toRow(r) : null;
  }

  /**
   * Atomically claim a batch of due PENDING entries by marking them DISPATCHED
   * within a single write transaction. SQLite's BEGIN IMMEDIATE serializes writers
   * so concurrent pollers won't double-claim.
   */
  async claimBatch(limit: number): Promise<OutboxRow[]> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.outboxEntry.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      });
      if (due.length === 0) return [];
      await tx.outboxEntry.updateMany({
        where: { id: { in: due.map((d) => d.id) } },
        data: { status: 'DISPATCHED' },
      });
      return due.map((d) => this.toRow({ ...d, status: 'DISPATCHED' }));
    });
  }

  /**
   * On worker failure: increment attempts, reschedule with exponential backoff,
   * or mark DEAD if MAX_ATTEMPTS reached.
   */
  async fail(id: string, error: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cur = await tx.outboxEntry.findUnique({ where: { id } });
      if (!cur) return;
      const attempts = cur.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await tx.outboxEntry.update({
          where: { id },
          data: { status: 'DEAD', attempts, lastError: error },
        });
        return;
      }
      const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 1000;
      await tx.outboxEntry.update({
        where: { id },
        data: {
          status: 'PENDING',
          attempts,
          lastError: error,
          nextAttemptAt: new Date(Date.now() + delay),
        },
      });
    });
  }

  /**
   * Re-arm DISPATCHED entries that have been stuck for longer than the threshold.
   * Used by the reaper: if the process crashed between marking DISPATCHED and
   * calling queue.add, the entry would be stuck forever without this.
   *
   * Returns the number of entries re-armed.
   */
  async reapStuckDispatched(stuckForMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - stuckForMs);
    // We use updatedAt (Prisma auto-tracks it on every update including the
    // claim that set status=DISPATCHED). Could also use a dedicated dispatchedAt
    // column for clarity, but reusing updatedAt avoids a schema migration.
    const result = await this.prisma.outboxEntry.updateMany({
      where: { status: 'DISPATCHED', updatedAt: { lt: cutoff } },
      data: { status: 'PENDING' },
    });
    return result.count;
  }

  private toRow(r: any): OutboxRow {
    return {
      id: r.id,
      aggregateId: r.aggregateId,
      eventType: r.eventType,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      status: r.status as OutboxStatus,
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt,
      lastError: r.lastError,
    };
  }
}
