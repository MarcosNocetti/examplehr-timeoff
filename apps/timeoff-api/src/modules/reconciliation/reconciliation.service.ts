import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OUTBOX_QUEUE } from '../outbox/outbox-dispatcher';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MovementRepository } from '../requests/movement.repository';
import { decideMerge } from './domain/reconciliation-merger';
import { MovementType, HcmBatchPayload, HcmRealtimeDelta } from '@examplehr/contracts';
import { OptimisticLockError } from '../../shared/errors/domain.errors';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';

@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: MovementRepository,
    @Inject(OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueBatch(payload: HcmBatchPayload): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    const chunks: Array<{ jobId: string; rows: any[] }> = [];
    for (let i = 0; i < payload.rows.length; i += 500) {
      chunks.push({ jobId: `${jobId}-${i}`, rows: payload.rows.slice(i, i + 500) });
    }
    await Promise.all(chunks.map((c) => this.queue.add('RECONCILE_BATCH', c, { jobId: c.jobId })));
    return { jobId };
  }

  async applyRealtime(delta: HcmRealtimeDelta): Promise<void> {
    await this.applyChunk([
      {
        employeeId: delta.employeeId,
        locationId: delta.locationId,
        totalDays: delta.newTotal,
        hcmTimestamp: delta.hcmTimestamp,
      },
    ]);
  }

  async applyChunk(rows: { employeeId: string; locationId: string; totalDays: string; hcmTimestamp: string }[]) {
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.balance.findUnique({
          where: { employeeId_locationId: { employeeId: row.employeeId, locationId: row.locationId } },
        });

        const decision = decideMerge(row, current ? {
          totalDays: new Decimal(current.totalDays.toString()),
          hcmLastSeenAt: current.hcmLastSeenAt,
        } : null);

        if (!decision.shouldUpdate) return;

        if (current) {
          const updateResult = await tx.balance.updateMany({
            where: {
              employeeId: row.employeeId,
              locationId: row.locationId,
              version: current.version,  // optimistic check: WHERE version = ?
            },
            data: {
              totalDays: row.totalDays,
              hcmLastSeenAt: new Date(row.hcmTimestamp),
              version: { increment: 1 },
            },
          });
          if (updateResult.count === 0) {
            throw new OptimisticLockError();
          }
        } else {
          await tx.balance.create({
            data: {
              employeeId: row.employeeId,
              locationId: row.locationId,
              totalDays: row.totalDays,
              hcmLastSeenAt: new Date(row.hcmTimestamp),
              version: 1,
            },
          });
        }

        await this.movements.create({
          employeeId: row.employeeId,
          locationId: row.locationId,
          delta: decision.deltaDays,
          type: MovementType.HCM_REFRESH,
          requestId: null,
          tx,
        });

        if (decision.deltaDays.abs().greaterThan(5)) {
          this.log.warn(
            { employeeId: row.employeeId, locationId: row.locationId, delta: decision.deltaDays.toString() },
            'DRIFT_DETECTED',
          );
        }
      });
    }
  }
}
