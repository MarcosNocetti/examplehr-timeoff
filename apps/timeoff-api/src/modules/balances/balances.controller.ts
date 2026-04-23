import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { BalancesService } from './balances.service';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain.errors';
import { Role } from '@examplehr/contracts';
import { EmployeeRepository } from '../employees/employee.repository';

@Controller('balances')
@UseGuards(TrustedHeadersGuard, RolesGuard)
export class BalancesController {
  constructor(
    private readonly svc: BalancesService,
    private readonly employees: EmployeeRepository,
  ) {}

  @Get(':employeeId')
  async list(@Param('employeeId') employeeId: string, @CurrentUser() user: CurrentUserPayload) {
    if (user.role === Role.EMPLOYEE && user.employeeId !== employeeId) {
      throw new ForbiddenError();
    }
    if (user.role === Role.MANAGER) {
      const target = await this.employees.findById(employeeId);
      if (!target) throw new NotFoundError(`Employee ${employeeId}`);
      // Manager can see own balance OR a team member's balance
      const isOwn = target.id === user.employeeId;
      const isOnTeam = target.managerId === user.employeeId;
      if (!isOwn && !isOnTeam) throw new ForbiddenError();
    }
    // admin: no restriction
    return this.svc.listForEmployee(employeeId);
  }
}
