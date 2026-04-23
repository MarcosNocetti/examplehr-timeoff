import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { BalanceRepository } from '../modules/balances/balance.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';
import { computeRawAvailable } from '../modules/balances/domain/balance-calculator';
import { MovementType, RequestStatus, SagaState } from '@examplehr/contracts';
import {
  HcmUnavailableError,
  HcmProtocolViolationError,
  OptimisticLockError,
} from '../shared/errors/domain.errors';

/**
 * Single BullMQ processor for the hcm-saga queue.
 * Routes to the correct handler based on job.name so that exactly
 * one Worker instance is registered for the queue — preventing the
 * "wrong processor picks up the job" race that occurs when multiple
 * @Processor classes all listen on the same queue name.
 */
@Processor('hcm-saga', { concurrency: 10 })
export class HcmSagaProcessor extends WorkerHost {
  private readonly log = new Logger(HcmSagaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    private readonly balances: BalanceRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
    private readonly reconciliation: ReconciliationService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    // The api container should not run BullMQ workers — they're only on the worker
    // container. BullMQ may have spawned a worker anyway because of the @Processor
    // decorator; no-op here to prevent double-processing.
    if (process.env.ROLE === 'api') return;

    switch (job.name) {
      case 'RESERVE_HCM':
        return this.handleReserve(job);
      case 'CONFIRM_HCM':
        return this.handleConfirm(job);
      case 'COMPENSATE_HCM':
        return this.handleCompensate(job);
      case 'RECONCILE_BATCH':
        return this.handleReconcile(job);
      default:
        this.log.warn({ jobName: job.name }, 'Unknown job name – skipping');
    }
  }

  // ── RESERVE ────────────────────────────────────────────────────────────────

  private async handleReserve(job: Job): Promise<void> {
    const { aggregateId: requestId, payload } = job.data as {
      aggregateId: string;
      payload: { employeeId: string; locationId: string; days: string; reservationId: string };
      outboxId: string;
    };

    const req = await this.requests.findById(requestId);
    if (!req || req.sagaState !== SagaState.RESERVING_HCM) {
      this.log.warn({ requestId, state: req?.sagaState }, 'Reserve job no-op (terminal/missing)');
      return;
    }

    try {
      await this.hcm.reserve({
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        days: payload.days,
        reservationId: payload.reservationId,
      });
    } catch (err: any) {
      if (err instanceof HcmUnavailableError) throw err; // BullMQ will retry
      if (err.code === 'INSUFFICIENT_BALANCE' || err.code === 'INVALID_DIMENSION') {
        await this.failRequest(req.id, payload, `HCM 4xx: ${err.code}`);
        return;
      }
      throw err;
    }

    // Defensive re-validation: even if HCM said OK, confirm locally.
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUnique({
        where: {
          employeeId_locationId: { employeeId: payload.employeeId, locationId: payload.locationId },
        },
      });
      const ms = await tx.timeOffMovement.findMany({
        where: { employeeId: payload.employeeId, locationId: payload.locationId },
      });
      const available = computeRawAvailable(
        new Decimal(balance!.totalDays.toString()),
        ms.map((m: any) => ({ delta: new Decimal(m.delta.toString()), type: m.type })),
      );
      if (available.lessThan(0)) {
        throw new HcmProtocolViolationError(
          `HCM accepted reservation but local invariant violated (available=${available})`,
        );
      }
      await this.requests.transition(req.id, RequestStatus.PENDING_APPROVAL, SagaState.AWAITING_APPROVAL, tx);
    });
  }

  private async failRequest(
    requestId: string,
    payload: { employeeId: string; locationId: string; days: string },
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.movements.create({
        employeeId: payload.employeeId,
        locationId: payload.locationId,
        delta: new Decimal(payload.days),
        type: MovementType.CANCELLED,
        requestId,
        tx,
      });
      await this.requests.transition(requestId, RequestStatus.FAILED, SagaState.TERMINAL, tx);
    });
    this.log.warn({ requestId, reason }, 'Request FAILED at reserve step');
  }

  // ── CONFIRM ────────────────────────────────────────────────────────────────

  private async handleConfirm(job: Job): Promise<void> {
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

  // ── COMPENSATE ─────────────────────────────────────────────────────────────

  private async handleCompensate(job: Job): Promise<void> {
    const { aggregateId, payload } = job.data as {
      aggregateId: string;
      payload: {
        reservationId: string;
        employeeId: string;
        locationId: string;
        days: string;
        intendedTerminalStatus?: RequestStatus;
      };
    };
    const req = await this.requests.findById(aggregateId);
    if (!req || req.sagaState !== SagaState.COMPENSATING_HCM) {
      this.log.warn({ requestId: aggregateId, state: req?.sagaState }, 'Compensate job no-op');
      return;
    }

    // Idempotency check: if a CANCELLED movement with a positive delta (release)
    // already exists for this request, hcm.release was already called on a prior
    // attempt. Skip the HCM call to avoid double-releasing the reservation.
    const existingMovements = await this.movements.listByRequestId(req.id);
    const alreadyReleasedInHcm = existingMovements.some(
      (m) => m.type === MovementType.CANCELLED && m.delta.greaterThan(0),
    );

    if (!alreadyReleasedInHcm) {
      try {
        await this.hcm.release({ reservationId: payload.reservationId });
      } catch (err: any) {
        if (err instanceof HcmUnavailableError) throw err;
        this.log.warn({ requestId: aggregateId, error: err.message }, 'HCM release error (continuing)');
      }
    } else {
      this.log.log({ requestId: aggregateId }, 'Compensate job replay — skipping HCM release (already released)');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.movements.create({
        employeeId: req.employeeId,
        locationId: req.locationId,
        delta: new Decimal(payload.days),
        type: MovementType.CANCELLED,
        requestId: req.id,
        tx,
      });
      const finalStatus = payload.intendedTerminalStatus ?? RequestStatus.CANCELLED;
      await this.requests.transition(req.id, finalStatus, SagaState.TERMINAL, tx);
    });
  }

  // ── RECONCILE ──────────────────────────────────────────────────────────────

  private async handleReconcile(job: Job): Promise<void> {
    await this.reconciliation.applyChunk(job.data.rows);
  }
}
