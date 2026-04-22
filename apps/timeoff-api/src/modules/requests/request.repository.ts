import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RequestStatus, SagaState } from '@examplehr/contracts';
import Decimal from 'decimal.js';

export interface RequestRow {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: Date;
  endDate: Date;
  days: Decimal;
  status: RequestStatus;
  sagaState: SagaState;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx: any = this.prisma): Promise<RequestRow | null> {
    const r = await tx.timeOffRequest.findUnique({ where: { id } });
    return r ? this.toRow(r) : null;
  }

  async findByIdempotencyKey(key: string): Promise<RequestRow | null> {
    const r = await this.prisma.timeOffRequest.findUnique({ where: { idempotencyKey: key } });
    return r ? this.toRow(r) : null;
  }

  async create(input: {
    employeeId: string; locationId: string; startDate: Date; endDate: Date; days: Decimal;
    idempotencyKey: string; tx: any;
  }): Promise<RequestRow> {
    const r = await input.tx.timeOffRequest.create({
      data: {
        employeeId: input.employeeId,
        locationId: input.locationId,
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days.toString(),
        status: RequestStatus.PENDING_APPROVAL,
        sagaState: SagaState.RESERVING_HCM,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return this.toRow(r);
  }

  async transition(id: string, status: RequestStatus, sagaState: SagaState, tx: any = this.prisma): Promise<RequestRow> {
    const r = await tx.timeOffRequest.update({ where: { id }, data: { status, sagaState } });
    return this.toRow(r);
  }

  async list(filter: { employeeId?: string; status?: RequestStatus }) {
    const rows = await this.prisma.timeOffRequest.findMany({ where: filter, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toRow(r));
  }

  // Public for testability — used by toRow consumers
  private toRow(r: any): RequestRow {
    return {
      id: r.id,
      employeeId: r.employeeId,
      locationId: r.locationId,
      startDate: r.startDate,
      endDate: r.endDate,
      days: new Decimal(r.days.toString()),
      status: r.status as RequestStatus,
      sagaState: r.sagaState as SagaState,
      idempotencyKey: r.idempotencyKey,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
