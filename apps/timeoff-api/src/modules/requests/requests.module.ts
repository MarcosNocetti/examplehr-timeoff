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

@Module({
  imports: [OutboxModule, BalancesModule, HcmClientModule, forwardRef(() => ReconciliationModule)],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    RequestRepository,
    MovementRepository,
    HcmSagaProcessor,
  ],
  exports: [RequestsService, RequestRepository, MovementRepository],
})
export class RequestsModule {}
