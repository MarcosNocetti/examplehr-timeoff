import { Module } from '@nestjs/common';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';
import { BalanceRepository } from './balance.repository';
import { MovementRepository } from '../requests/movement.repository';

@Module({
  controllers: [BalancesController],
  providers: [BalancesService, BalanceRepository, MovementRepository],
  exports: [BalanceRepository, MovementRepository, BalancesService],
})
export class BalancesModule {}
