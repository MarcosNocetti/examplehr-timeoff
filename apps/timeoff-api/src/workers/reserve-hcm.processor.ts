import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { OutboxRepository } from '../modules/outbox/outbox.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { computeAvailable, computeRawAvailable } from '../modules/balances/domain/balance-calculator';
import { MovementType, SagaState, RequestStatus } from '@examplehr/contracts';
import { HcmUnavailableError, HcmProtocolViolationError } from '../shared/errors/domain.errors';

@Processor('hcm-saga', { concurrency: 10 })
export class ReserveHcmProcessor extends WorkerHost {
  private readonly log = new Logger(ReserveHcmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    private readonly outbox: OutboxRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'RESERVE_HCM') return;
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
      // Use the raw (unclamped) computation here so that HCM over-acceptance is
      // detectable even though the presentation layer clamps to 0.
      const available = computeRawAvailable(
        new Decimal(balance!.totalDays.toString()),
        ms.map((m: any) => ({ delta: new Decimal(m.delta.toString()), type: m.type })),
      );
      // available already accounts for the PENDING_RESERVATION we wrote at create time.
      // If it is negative, HCM lied to us.
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
        delta: new Decimal(payload.days), // positive — releases the original PENDING_RESERVATION
        type: MovementType.CANCELLED,
        requestId,
        tx,
      });
      await this.requests.transition(requestId, RequestStatus.FAILED, SagaState.TERMINAL, tx);
    });
    this.log.warn({ requestId, reason }, 'Request FAILED at reserve step');
  }
}
