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
export class ConfirmHcmProcessor extends WorkerHost {
  private readonly log = new Logger(ConfirmHcmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestRepository,
    private readonly movements: MovementRepository,
    @Inject(HCM_PORT) private readonly hcm: HcmPort,
  ) {
    super();
  }

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

    try {
      await this.hcm.confirm({ reservationId: payload.reservationId });
    } catch (err: any) {
      if (err instanceof HcmUnavailableError) throw err;
      throw err;
    }

    await this.prisma.$transaction(async (tx) => {
      // CONFIRMED(-days) records the actual consumption
      await this.movements.create({
        employeeId: req.employeeId,
        locationId: req.locationId,
        delta: new Decimal(payload.days).negated(),
        type: MovementType.CONFIRMED,
        requestId: req.id,
        tx,
      });
      // CANCELLED(+days) offsets the original PENDING_RESERVATION
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
