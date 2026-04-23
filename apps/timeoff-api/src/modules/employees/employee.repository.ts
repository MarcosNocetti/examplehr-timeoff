import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Role } from '@examplehr/contracts';

export interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  managerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<EmployeeRow | null> {
    const r = await this.prisma.employee.findUnique({ where: { id } });
    return r ? this.toRow(r) : null;
  }

  async findByEmail(email: string): Promise<EmployeeRow | null> {
    const r = await this.prisma.employee.findUnique({ where: { email } });
    return r ? this.toRow(r) : null;
  }

  async listAll(): Promise<EmployeeRow[]> {
    const rows = await this.prisma.employee.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toRow(r));
  }

  async listTeamOf(managerId: string): Promise<EmployeeRow[]> {
    const rows = await this.prisma.employee.findMany({
      where: { managerId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toRow(r));
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
    });
    return this.toRow(r);
  }

  async update(
    id: string,
    patch: { name?: string; email?: string; role?: Role; managerId?: string | null },
  ): Promise<EmployeeRow> {
    const r = await this.prisma.employee.update({ where: { id }, data: patch });
    return this.toRow(r);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.employee.delete({ where: { id } });
  }

  private toRow(r: any): EmployeeRow {
    return {
      id: r.id, name: r.name, email: r.email, role: r.role as Role,
      managerId: r.managerId, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
}
