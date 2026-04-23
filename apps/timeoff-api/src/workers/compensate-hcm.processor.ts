import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { MovementType, RequestStatus, SagaState } from '@examplehr/contracts';
import { HcmUnavailableError } from '../shared/errors/domain.errors';

@Injectable()
export class CompensateHcmProcessor {
  private readonly log = new Logger(CompensateHcmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
  ) {}

  async process(job: Job): Promise<void> {
    if (job.name !== 'COMPENSATE_HCM') return;
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
        // For compensation, even if HCM 4xx (e.g., reservation not found in HCM),
        // we still want to release locally. Log + continue.
        this.log.warn({ requestId: aggregateId, error: err.message }, 'HCM release error (continuing)');
      }
    } else {
      this.log.log({ requestId: aggregateId }, 'Compensate job replay — skipping HCM release (already released)');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.movements.create({
        employeeId: req.employeeId,
        locationId: req.locationId,
        delta: new Decimal(payload.days), // positive — releases the original PENDING_RESERVATION
        type: MovementType.CANCELLED,
        requestId: req.id,
        tx,
      });
      const finalStatus = payload.intendedTerminalStatus ?? RequestStatus.CANCELLED;
      await this.requests.transition(req.id, finalStatus, SagaState.TERMINAL, tx);
    });
  }
}
