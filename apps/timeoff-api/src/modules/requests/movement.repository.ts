import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MovementType } from '@examplehr/contracts';
import Decimal from 'decimal.js';

export interface MovementRow {
  id: string;
  employeeId: string;
  locationId: string;
  delta: Decimal;
  type: MovementType;
  requestId: string | null;
  createdAt: Date;
}

@Injectable()
export class MovementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    employeeId: string; locationId: string; delta: Decimal; type: MovementType; requestId?: string | null;
    tx?: any;
  }): Promise<MovementRow> {
    const client = input.tx ?? this.prisma;
    const row = await client.timeOffMovement.create({
      data: {
        employeeId: input.employeeId,
        locationId: input.locationId,
        delta: input.delta.toString(),
        type: input.type,
        requestId: input.requestId ?? null,
      },
    });
    return this.toRow(row);
  }

  async listForBalance(employeeId: string, locationId: string): Promise<MovementRow[]> {
    const rows = await this.prisma.timeOffMovement.findMany({
      where: { employeeId, locationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toRow(r));
  }

  async listForEmployee(employeeId: string): Promise<MovementRow[]> {
    const rows = await this.prisma.timeOffMovement.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toRow(r));
  }

  async listByRequestId(requestId: string): Promise<MovementRow[]> {
    const rows = await this.prisma.timeOffMovement.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toRow(r));
  }

  private toRow(r: any): MovementRow {
    return {
      id: r.id,
      employeeId: r.employeeId,
      locationId: r.locationId,
      delta: new Decimal(r.delta.toString()),
      type: r.type as MovementType,
      requestId: r.requestId,
      createdAt: r.createdAt,
    };
  }
}
