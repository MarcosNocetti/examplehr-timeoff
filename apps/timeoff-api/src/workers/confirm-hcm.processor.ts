import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { BalanceRepository } from '../modules/balances/balance.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { MovementType, RequestStatus, SagaState } from '@examplehr/contracts';
import { HcmUnavailableError, HcmProtocolViolationError, OptimisticLockError } from '../shared/errors/domain.errors';

@Injectable()
export class ConfirmHcmProcessor {
  private readonly log = new Logger(ConfirmHcmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    private readonly balances: BalanceRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
  ) {}

  async process(job: Job): Promise<void> {
    if (job.name !== 'CONFIRM_HCM') return;
    const { aggregateId, payload } = job.data as {
      aggregateId: string;
      payload: { reservationId: string; employeeId: string; locationId: string; days: string };
    };
    const req = await this.requests.findById(aggregateId);
    if (!req || req.sagaState !== SagaState.COMMITTING_HCM) {
      this.log.warn({ requestId: aggregateId, state: req?.sagaState }, 'Confirm job no-op');
      return;
    }

    // Idempotency check: if a CONFIRMED movement already exists for this request,
    // we already called HCM successfully on a prior attempt. Skip the HCM call
    // (which is not idempotent on the in-memory mock) but still finish the local
    // state transition in case the prior attempt crashed before it.
    const existingMovements = await this.movements.listByRequestId(req.id);
    const alreadyConfirmedInHcm = existingMovements.some((m) => m.type === MovementType.CONFIRMED);

    if (!alreadyConfirmedInHcm) {
      try {
        await this.hcm.confirm({ reservationId: payload.reservationId });
      } catch (err: any) {
        if (err instanceof HcmUnavailableError) throw err;
        throw err;
      }
    } else {
      this.log.log({ requestId: aggregateId }, 'Confirm job replay — skipping HCM call (already confirmed)');
    }

    // Fetch HCM's post-confirm balance to sync totalDays locally.
    const hcmBalance = await this.hcm.getBalance(payload.employeeId, payload.locationId);

    await this.prisma.$transaction(async (tx) => {
      // Read current version for optimistic lock check.
      const currentBalance = await tx.balance.findUnique({
        where: { employeeId_locationId: { employeeId: payload.employeeId, locationId: payload.locationId } },
      });
      if (!currentBalance) {
        throw new HcmProtocolViolationError(
          `Balance row missing for ${payload.employeeId}/${payload.locationId} during confirm`,
        );
      }
      // Update local balance.totalDays to match what HCM reports after deduction.
      // WHERE version = ? guards against concurrent writers (defense-in-depth).
      const updateResult = await tx.balance.updateMany({
        where: {
          employeeId: payload.employeeId,
          locationId: payload.locationId,
          version: currentBalance.version,  // optimistic check
        },
        data: {
          totalDays: hcmBalance.totalDays,
          hcmLastSeenAt: new Date(hcmBalance.hcmTimestamp),
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        throw new OptimisticLockError();
      }
      // CONFIRMED(+days) releases the PENDING_RESERVATION — net zero in RESERVATION_TYPES.
      // The actual deduction is captured by the totalDays reduction above.
      await this.movements.create({
        employeeId: req.employeeId,
        locationId: req.locationId,
        delta: new Decimal(payload.days),
        type: MovementType.CONFIRMED,
        requestId: req.id,
        tx,
      });
      // CANCELLED(+days) explicitly closes the original PENDING_RESERVATION entry.
      await this.movements.create({
        employeeId: req.employeeId,
        locationId: req.locationId,
        delta: new Decimal(payload.days),
        type: MovementType.CANCELLED,
        requestId: req.id,
        tx,
      });
      await this.requests.transition(req.id, RequestStatus.APPROVED, SagaState.TERMINAL, tx);
    });
  }
}
