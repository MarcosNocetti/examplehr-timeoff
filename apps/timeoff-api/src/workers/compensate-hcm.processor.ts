import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { MovementType, RequestStatus, SagaState } from '@examplehr/contracts';
import { HcmUnavailableError } from '../shared/errors/domain.errors';

@Processor('hcm-saga', { concurrency: 10 })
export class CompensateHcmProcessor extends WorkerHost {
  private readonly log = new Logger(CompensateHcmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
  ) {
    super();
  }

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

    try {
      await this.hcm.release({ reservationId: payload.reservationId });
    } catch (err: any) {
      if (err instanceof HcmUnavailableError) throw err;
      // For compensation, even if HCM 4xx (e.g., reservation not found in HCM),
      // we still want to release locally. Log + continue.
      this.log.warn({ requestId: aggregateId, error: err.message }, 'HCM release error (continuing)');
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
