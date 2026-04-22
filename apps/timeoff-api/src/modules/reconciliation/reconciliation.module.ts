import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconcileBatchProcessor } from '../../workers/reconcile-batch.processor';
import { BalancesModule } from '../balances/balances.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [BalancesModule, OutboxModule],
  providers: [ReconciliationService, ReconcileBatchProcessor],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
