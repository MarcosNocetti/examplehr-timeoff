import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { Roles } from '../../shared/auth/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { Public } from '../../shared/auth/public.decorator';
import { EmployeeRepository } from './employee.repository';
import { CreateEmployeeBody, UpdateEmployeeBody } from './dto/employee.dto';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain.errors';
import { Role } from '@examplehr/contracts';

@Controller('employees')
@UseGuards(TrustedHeadersGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly repo: EmployeeRepository) {}

  /** Any authenticated user — return own profile. Used by the frontend after login. */
  @Get('me')
  async me(@CurrentUser() user: CurrentUserPayload) {
    const me = await this.repo.findById(user.employeeId);
    if (!me) throw new NotFoundError(`Employee ${user.employeeId}`);
    return me;
  }

  /** Manager only — return employees who report to me. */
  @Get('team')
  async team(@CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.MANAGER && user.role !== Role.ADMIN) throw new ForbiddenError();
    return this.repo.listTeamOf(user.employeeId);
  }

  /** Public — minimal info for the login screen. No auth required. */
  @Get('directory')
  @Public()
  async directory() {
    const all = await this.repo.listAll();
    return all.map((e) => ({ id: e.id, name: e.name, role: e.role }));
  }

  /** Admin only. Full list. */
  @Get()
  @Roles(Role.ADMIN)
  list() { return this.repo.listAll(); }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() body: CreateEmployeeBody) {
    return this.repo.create(body);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@Param('id') id: string, @Body() body: UpdateEmployeeBody) {
    const exists = await this.repo.findById(id);
    if (!exists) throw new NotFoundError(`Employee ${id}`);
    return this.repo.update(id, body);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async delete(@Param('id') id: string) {
    const exists = await this.repo.findById(id);
    if (!exists) throw new NotFoundError(`Employee ${id}`);
    await this.repo.delete(id);
    return { ok: true };
  }
}
