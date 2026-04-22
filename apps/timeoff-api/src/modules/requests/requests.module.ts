import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestRepository } from './request.repository';
import { MovementRepository } from './movement.repository';
import { OutboxModule } from '../outbox/outbox.module';
import { BalancesModule } from '../balances/balances.module';

@Module({
  imports: [OutboxModule, BalancesModule],
  providers: [RequestsService, RequestRepository, MovementRepository],
  exports: [RequestsService, RequestRepository, MovementRepository],
})
export class RequestsModule {}
