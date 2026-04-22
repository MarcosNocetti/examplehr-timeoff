import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestRepository } from './request.repository';
import { MovementRepository } from './movement.repository';
import { OutboxModule } from '../outbox/outbox.module';
import { BalancesModule } from '../balances/balances.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';
import { ReserveHcmProcessor } from '../../workers/reserve-hcm.processor';

@Module({
  imports: [OutboxModule, BalancesModule, HcmClientModule],
  providers: [RequestsService, RequestRepository, MovementRepository, ReserveHcmProcessor],
  exports: [RequestsService, RequestRepository, MovementRepository],
})
export class RequestsModule {}
