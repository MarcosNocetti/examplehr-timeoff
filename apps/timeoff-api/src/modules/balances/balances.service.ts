import { Injectable } from '@nestjs/common';
import { BalanceRepository } from './balance.repository';
import { MovementRepository, MovementRow } from '../requests/movement.repository';
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
    if (rows.length === 0) return [];
    // Single query for all movements of this employee (avoids N+1)
    const allMovements = await this.movements.listForEmployee(employeeId);
    // Group by locationId in memory
    const byLocation = new Map<string, MovementRow[]>();
    for (const m of allMovements) {
      const list = byLocation.get(m.locationId) ?? [];
      list.push(m);
      byLocation.set(m.locationId, list);
    }
    return rows.map((b) => {
      const ms = byLocation.get(b.locationId) ?? [];
      const available = computeAvailable(b.totalDays, ms);
      return {
        employeeId: b.employeeId,
        locationId: b.locationId,
        totalDays: b.totalDays.toString(),
        availableDays: available.toString(),
        version: b.version,
        hcmLastSeenAt: b.hcmLastSeenAt.toISOString(),
      };
    });
  }
}
