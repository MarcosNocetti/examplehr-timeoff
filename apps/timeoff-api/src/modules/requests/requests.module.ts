import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestRepository } from './request.repository';
import { MovementRepository } from './movement.repository';
import { RequestsController } from './requests.controller';
import { OutboxModule } from '../outbox/outbox.module';
import { BalancesModule } from '../balances/balances.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';
import { ReserveHcmProcessor } from '../../workers/reserve-hcm.processor';
import { ConfirmHcmProcessor } from '../../workers/confirm-hcm.processor';
import { CompensateHcmProcessor } from '../../workers/compensate-hcm.processor';

@Module({
  imports: [OutboxModule, BalancesModule, HcmClientModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestRepository, MovementRepository, ReserveHcmProcessor, ConfirmHcmProcessor, CompensateHcmProcessor],
  exports: [RequestsService, RequestRepository, MovementRepository],
})
export class RequestsModule {}
