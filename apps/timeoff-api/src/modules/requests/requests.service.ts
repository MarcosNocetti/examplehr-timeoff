import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RequestRepository } from './request.repository';
import { MovementRepository } from './movement.repository';
import { BalanceRepository } from '../balances/balance.repository';
import { OutboxService } from '../outbox/outbox.service';
import { computeAvailable } from '../balances/domain/balance-calculator';
import { computeDays, assertSufficient } from './domain/request-validator';
import { MovementType } from '@examplehr/contracts';
import { NotFoundError } from '../../shared/errors/domain.errors';

export interface CreateInput {
  employeeId: string;
  locationId: string;
  startDate: Date;
  endDate: Date;
  idempotencyKey: string;
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    private readonly balances: BalanceRepository,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: CreateInput) {
    // Fast-path idempotency check (read-only) BEFORE entering tx.
    const existing = await this.requests.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const days = computeDays(input.startDate, input.endDate);

    return this.prisma.$transaction(async (tx) => {
      // Re-check inside tx for race safety.
      const dup = await tx.timeOffRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (dup) {
        // Reuse repository's row mapping by fetching via the wrapper (it accepts tx).
        return (await this.requests.findById(dup.id, tx))!;
      }

      const balance = await tx.balance.findUnique({
        where: { employeeId_locationId: { employeeId: input.employeeId, locationId: input.locationId } },
      });
      if (!balance) {
        throw new NotFoundError(`Balance for employee=${input.employeeId} location=${input.locationId}`);
      }

      const movements = await tx.timeOffMovement.findMany({
        where: { employeeId: input.employeeId, locationId: input.locationId },
      });

      const available = computeAvailable(
        new Decimal(balance.totalDays.toString()),
        movements.map((m: any) => ({
          delta: new Decimal(m.delta.toString()),
          type: m.type,
        })),
      );
      assertSufficient(available, days);

      const created = await this.requests.create({ ...input, days, tx });

      await this.movements.create({
        employeeId: input.employeeId,
        locationId: input.locationId,
        delta: days.negated(),
        type: MovementType.PENDING_RESERVATION,
        requestId: created.id,
        tx,
      });

      await this.outbox.enqueueInTx(tx, created.id, 'RESERVE_HCM', {
        employeeId: input.employeeId,
        locationId: input.locationId,
        days: days.toString(),
        reservationId: created.id,
      });

      return created;
    });
  }
}
