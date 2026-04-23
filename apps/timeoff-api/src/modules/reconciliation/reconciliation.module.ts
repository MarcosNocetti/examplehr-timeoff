import { forwardRef, Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { BalancesModule } from '../balances/balances.module';
import { OutboxModule } from '../outbox/outbox.module';
import { RequestsModule } from '../requests/requests.module';

@Module({
  imports: [BalancesModule, OutboxModule, forwardRef(() => RequestsModule)],
  providers: [ReconciliationService],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
