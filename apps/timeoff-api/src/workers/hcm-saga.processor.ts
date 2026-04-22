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

    try {
      await this.hcm.confirm({ reservationId: payload.reservationId });
    } catch (err: any) {
      if (err instanceof HcmUnavailableError) throw err;
      throw err;
    }

    // Fetch HCM's post-confirm balance to sync totalDays locally.
    const hcmBalance = await this.hcm.getBalance(payload.employeeId, payload.locationId);

    await this.prisma.$transaction(async (tx) => {
      // Update local balance.totalDays to match what HCM reports after deduction.
      await tx.balance.update({
        where: { employeeId_locationId: { employeeId: payload.employeeId, locationId: payload.locationId } },
        data: {
          totalDays: hcmBalance.totalDays,
          hcmLastSeenAt: new Date(hcmBalance.hcmTimestamp),
          version: { increment: 1 },
        },
      });
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

    try {
      await this.hcm.release({ reservationId: payload.reservationId });
    } catch (err: any) {
      if (err instanceof HcmUnavailableError) throw err;
      this.log.warn({ requestId: aggregateId, error: err.message }, 'HCM release error (continuing)');
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
