import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from '@nestjs/common';
import { HcmService } from './hcm.service';
import { HcmReserveRequest, HcmConfirmRequest, HcmReleaseRequest } from '@examplehr/contracts';
import { HcmExceptionFilter } from '../shared/hcm-exception.filter';

@Controller('hcm')
@UseFilters(HcmExceptionFilter)
export class HcmController {
  constructor(private readonly svc: HcmService) {}

  @Get('balances/:employeeId/:locationId')
  getBalance(@Param('employeeId') e: string, @Param('locationId') l: string) {
    return this.svc.getBalance(e, l);
  }

  @Post('reservations')
  @HttpCode(201)
  reserve(@Body() body: HcmReserveRequest) { return this.svc.reserve(body); }

  @Post('reservations/confirm')
  @HttpCode(200)
  confirm(@Body() body: HcmConfirmRequest) { this.svc.confirm(body); return { ok: true }; }

  @Post('reservations/release')
  @HttpCode(200)
  release(@Body() body: HcmReleaseRequest) { this.svc.release(body); return { ok: true }; }
}
