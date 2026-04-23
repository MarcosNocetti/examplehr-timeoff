import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { Roles } from '../../shared/auth/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { RequestsService } from './requests.service';
import { CreateRequestBody, RejectRequestBody, ForceFailBody } from './dto/create-request.dto';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain.errors';
import { Role, RequestStatus } from '@examplehr/contracts';
import { EmployeeRepository } from '../employees/employee.repository';

@Controller('requests')
@UseGuards(TrustedHeadersGuard, RolesGuard)
export class RequestsController {
  constructor(
    private readonly svc: RequestsService,
    private readonly employees: EmployeeRepository,
  ) {}

  @Post()
  @HttpCode(201)
  @Roles(Role.EMPLOYEE)
  async create(@Body() body: CreateRequestBody, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.create({
      employeeId: user.employeeId,
      locationId: body.locationId,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get()
  async list(
    @Query('status') status: RequestStatus | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    let rows;
    if (user.role === Role.EMPLOYEE) {
      rows = await this.svc.list({ employeeId: user.employeeId, status });
    } else if (user.role === Role.MANAGER) {
      const team = await this.employees.listTeamOf(user.employeeId);
      const teamIds = new Set([user.employeeId, ...team.map((m) => m.id)]);
      const all = await this.svc.list({ status });
      rows = all.filter((r) => teamIds.has(r.employeeId));
    } else {
      // admin
      rows = await this.svc.list({ status });
    }
    return this.enrichWithEmployeeName(rows);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const r = await this.svc.findById(id);
    if (!r) throw new NotFoundError(`TimeOffRequest ${id}`);
    // Ownership check: employees may only see their own requests
    if (user.role === Role.EMPLOYEE && r.employeeId !== user.employeeId) {
      throw new ForbiddenError();
    }
    const [enriched] = await this.enrichWithEmployeeName([r]);
    return enriched;
  }

  /** Adds employeeName to each request row via a single batched lookup. */
  private async enrichWithEmployeeName<T extends { employeeId: string }>(
    rows: T[],
  ): Promise<Array<T & { employeeName: string | null }>> {
    if (rows.length === 0) return [];
    const nameById = await this.employees.nameMapByIds(rows.map((r) => r.employeeId));
    return rows.map((r) => ({ ...r, employeeName: nameById.get(r.employeeId) ?? null }));
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER, Role.ADMIN)
  async approve(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    if (user.role === Role.MANAGER) {
      const req = await this.svc.findById(id);
      if (!req) throw new NotFoundError(`TimeOffRequest ${id}`);
      const target = await this.employees.findById(req.employeeId);
      if (!target || target.managerId !== user.employeeId) throw new ForbiddenError();
    }
    return this.svc.approve(id);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER, Role.ADMIN)
  async reject(
    @Param('id') id: string,
    @Body() body: RejectRequestBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (user.role === Role.MANAGER) {
      const req = await this.svc.findById(id);
      if (!req) throw new NotFoundError(`TimeOffRequest ${id}`);
      const target = await this.employees.findById(req.employeeId);
      if (!target || target.managerId !== user.employeeId) throw new ForbiddenError();
    }
    return this.svc.reject(id, body.reason);
  }

  @Post(':id/cancel')
  @Roles(Role.EMPLOYEE)
  async cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const r = await this.svc.findById(id);
    if (!r) throw new NotFoundError(`TimeOffRequest ${id}`);
    // Ownership check: employee can only cancel their own request
    if (r.employeeId !== user.employeeId) throw new ForbiddenError();
    return this.svc.cancel(id);
  }

  @Post(':id/force-fail')
  @Roles(Role.ADMIN)
  forceFail(
    @Param('id') id: string,
    @Body() body: ForceFailBody,
  ) {
    return this.svc.forceFail(id, body.reason);
  }
}
