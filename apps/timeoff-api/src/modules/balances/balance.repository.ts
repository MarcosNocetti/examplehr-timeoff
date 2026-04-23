import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OptimisticLockError } from '../../shared/errors/domain.errors';
import Decimal from 'decimal.js';

export interface BalanceRow {
  employeeId: string;
  locationId: string;
  totalDays: Decimal;
  version: number;
  hcmLastSeenAt: Date;
}

export type UpsertResult = 'CREATED' | 'UPDATED' | 'SKIPPED_STALE';

@Injectable()
export class BalanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(employeeId: string, locationId: string): Promise<BalanceRow | null> {
    const row = await this.prisma.balance.findUnique({
      where: { employeeId_locationId: { employeeId, locationId } },
    });
    return row && this.toRow(row);
  }

  async findByEmployee(employeeId: string): Promise<BalanceRow[]> {
    const rows = await this.prisma.balance.findMany({ where: { employeeId } });
    return rows.map((r) => this.toRow(r));
  }

  async upsertFromHcm(input: {
    employeeId: string;
    locationId: string;
    totalDays: Decimal;
    hcmTimestamp: Date;
  }): Promise<UpsertResult> {
    return this.prisma.$transaction(async (tx) => {
      // BEGIN IMMEDIATE-equivalent: write transaction acquires reserved lock
      const existing = await tx.balance.findUnique({
        where: { employeeId_locationId: { employeeId: input.employeeId, locationId: input.locationId } },
      });
      if (!existing) {
        await tx.balance.create({
          data: {
            employeeId: input.employeeId,
            locationId: input.locationId,
            totalDays: input.totalDays.toString(),
            hcmLastSeenAt: input.hcmTimestamp,
            version: 1,
          },
        });
        return 'CREATED';
      }
      if (input.hcmTimestamp <= existing.hcmLastSeenAt) return 'SKIPPED_STALE';
      const updateResult = await tx.balance.updateMany({
        where: {
          employeeId: input.employeeId,
          locationId: input.locationId,
          version: existing.version,  // optimistic check: WHERE version = ?
        },
        data: {
          totalDays: input.totalDays.toString(),
          hcmLastSeenAt: input.hcmTimestamp,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        throw new OptimisticLockError();
      }
      return 'UPDATED';
    });
  }

  private toRow(r: any): BalanceRow {
    return {
      employeeId: r.employeeId,
      locationId: r.locationId,
      totalDays: new Decimal(r.totalDays.toString()),
      version: r.version,
      hcmLastSeenAt: r.hcmLastSeenAt,
    };
  }
}
