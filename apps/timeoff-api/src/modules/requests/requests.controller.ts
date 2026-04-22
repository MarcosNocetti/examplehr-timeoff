import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { RequestsService } from './requests.service';
import { CreateRequestBody, RejectRequestBody, ForceFailBody } from './dto/create-request.dto';
import { ForbiddenError, NotFoundError } from '../../shared/errors/domain.errors';
import { Role, RequestStatus } from '@examplehr/contracts';

@Controller('requests')
@UseGuards(TrustedHeadersGuard)
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateRequestBody, @CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.EMPLOYEE) throw new ForbiddenError();
    return this.svc.create({
      employeeId: user.employeeId,
      locationId: body.locationId,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get()
  list(
    @Query('status') status: RequestStatus | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.list({
      employeeId: user.role === Role.EMPLOYEE ? user.employeeId : undefined,
      status,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const r = await this.svc.findById(id);
    if (!r) throw new NotFoundError(`TimeOffRequest ${id}`);
    if (user.role === Role.EMPLOYEE && r.employeeId !== user.employeeId) {
      throw new ForbiddenError();
    }
    return r;
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.MANAGER && user.role !== Role.ADMIN) throw new ForbiddenError();
    return this.svc.approve(id);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: RejectRequestBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (user.role !== Role.MANAGER && user.role !== Role.ADMIN) throw new ForbiddenError();
    return this.svc.reject(id, body.reason);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.EMPLOYEE) throw new ForbiddenError();
    const r = await this.svc.findById(id);
    if (!r) throw new NotFoundError(`TimeOffRequest ${id}`);
    if (r.employeeId !== user.employeeId) throw new ForbiddenError();
    return this.svc.cancel(id);
  }

  @Post(':id/force-fail')
  forceFail(
    @Param('id') id: string,
    @Body() body: ForceFailBody,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (user.role !== Role.ADMIN) throw new ForbiddenError();
    return this.svc.forceFail(id, body.reason);
  }
}
