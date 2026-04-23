import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Role } from '@examplehr/contracts';

export interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  managerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<EmployeeRow | null> {
    const r = await this.prisma.employee.findUnique({
      where: { id },
      include: { manager: { select: { name: true } } },
    });
    return r ? this.toRow(r) : null;
  }

  async findByEmail(email: string): Promise<EmployeeRow | null> {
    const r = await this.prisma.employee.findUnique({
      where: { email },
      include: { manager: { select: { name: true } } },
    });
    return r ? this.toRow(r) : null;
  }

  async listAll(): Promise<EmployeeRow[]> {
    const rows = await this.prisma.employee.findMany({
      orderBy: { createdAt: 'asc' },
      include: { manager: { select: { name: true } } },
    });
    return rows.map((r) => this.toRow(r));
  }

  async listTeamOf(managerId: string): Promise<EmployeeRow[]> {
    const rows = await this.prisma.employee.findMany({
      where: { managerId },
      orderBy: { name: 'asc' },
      include: { manager: { select: { name: true } } },
    });
    return rows.map((r) => this.toRow(r));
  }

  /** Cheap lookup for enrichment: returns id → name map. Used to add
   *  employeeName to request listings without N+1 queries. */
  async nameMapByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async create(input: {
    name: string; email: string; role: Role; managerId?: string | null;
  }): Promise<EmployeeRow> {
    const r = await this.prisma.employee.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        managerId: input.managerId ?? null,
      },
      include: { manager: { select: { name: true } } },
    });
    return this.toRow(r);
  }

  async update(
    id: string,
    patch: { name?: string; email?: string; role?: Role; managerId?: string | null },
  ): Promise<EmployeeRow> {
    const r = await this.prisma.employee.update({
      where: { id },
      data: patch,
      include: { manager: { select: { name: true } } },
    });
    return this.toRow(r);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.employee.delete({ where: { id } });
  }

  private toRow(r: any): EmployeeRow {
    return {
      id: r.id, name: r.name, email: r.email, role: r.role as Role,
      managerId: r.managerId, managerName: r.manager?.name ?? null,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
}
