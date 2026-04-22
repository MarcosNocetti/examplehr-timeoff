import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Decimal from 'decimal.js';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RequestRepository } from '../modules/requests/request.repository';
import { MovementRepository } from '../modules/requests/movement.repository';
import { BalanceRepository } from '../modules/balances/balance.repository';
import { HCM_PORT, HcmPort } from '../modules/hcm-client/hcm.port';
import { MovementType, RequestStatus, SagaState } from '@examplehr/contracts';
import { HcmUnavailableError } from '../shared/errors/domain.errors';

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
}
