import { forwardRef, Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestRepository } from './request.repository';
import { RequestsController } from './requests.controller';
import { OutboxModule } from '../outbox/outbox.module';
import { BalancesModule } from '../balances/balances.module';
import { HcmClientModule } from '../hcm-client/hcm-client.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { HcmSagaProcessor } from '../../workers/hcm-saga.processor';
import { EmployeesModule } from '../employees/employees.module';

@Module({
  imports: [OutboxModule, BalancesModule, HcmClientModule, forwardRef(() => ReconciliationModule), EmployeesModule],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    RequestRepository,
    HcmSagaProcessor,
  ],
  // MovementRepository is declared and exported by BalancesModule; no duplicate needed here.
  exports: [RequestsService, RequestRepository],
})
export class RequestsModule {}
