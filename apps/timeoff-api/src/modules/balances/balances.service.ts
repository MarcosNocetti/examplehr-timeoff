import { Injectable } from '@nestjs/common';
import { BalanceRepository } from './balance.repository';
import { MovementRepository } from '../requests/movement.repository';
import { computeAvailable } from './domain/balance-calculator';
import { BalanceDto } from '@examplehr/contracts';

@Injectable()
export class BalancesService {
  constructor(
    private readonly balances: BalanceRepository,
    private readonly movements: MovementRepository,
  ) {}

  async listForEmployee(employeeId: string): Promise<BalanceDto[]> {
    const rows = await this.balances.findByEmployee(employeeId);
    return Promise.all(
      rows.map(async (b) => {
        const ms = await this.movements.listForBalance(b.employeeId, b.locationId);
        const available = computeAvailable(b.totalDays, ms);
        return {
          employeeId: b.employeeId,
          locationId: b.locationId,
          totalDays: b.totalDays.toString(),
          availableDays: available.toString(),
          version: b.version,
          hcmLastSeenAt: b.hcmLastSeenAt.toISOString(),
        };
      }),
    );
  }
}
