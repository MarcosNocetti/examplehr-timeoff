import { forwardRef, Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestRepository } from './request.repository';
import { MovementRepository } from './movement.repository';
import { RequestsController } from './requests.controller';
import { OutboxModule } from '../outbox/outbox.module';
import { BalancesModule } from '../balances/balances.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { HcmSagaProcessor } from '../../workers/hcm-saga.processor';
import { ReserveHcmProcessor } from '../../workers/reserve-hcm.processor';
import { ConfirmHcmProcessor } from '../../workers/confirm-hcm.processor';
import { CompensateHcmProcessor } from '../../workers/compensate-hcm.processor';

@Module({
  imports: [OutboxModule, BalancesModule, HcmClientModule, forwardRef(() => ReconciliationModule)],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    RequestRepository,
    MovementRepository,
    ReserveHcmProcessor,
    ConfirmHcmProcessor,
    CompensateHcmProcessor,
    HcmSagaProcessor, // the ONLY class that subscribes to the BullMQ queue
  ],
  exports: [RequestsService, RequestRepository, MovementRepository],
})
export class RequestsModule {}
