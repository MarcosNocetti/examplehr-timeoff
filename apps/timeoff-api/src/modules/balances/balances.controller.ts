import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { BalancesService } from './balances.service';
import { ForbiddenError } from '../../shared/errors/domain.errors';
import { Role } from '@examplehr/contracts';

@Controller('balances')
@UseGuards(TrustedHeadersGuard, RolesGuard)
export class BalancesController {
  constructor(private readonly svc: BalancesService) {}

  @Get(':employeeId')
  async list(@Param('employeeId') employeeId: string, @CurrentUser() user: CurrentUserPayload) {
    // Ownership check: employees may only read their own balance (URL param vs user identity)
    if (user.role === Role.EMPLOYEE && user.employeeId !== employeeId) {
      throw new ForbiddenError();
    }
    return this.svc.listForEmployee(employeeId);
  }
}
