import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { Roles } from '../../shared/auth/roles.decorator';
import { ReconciliationService } from './reconciliation.service';
import { Role, HcmBatchPayload, HcmRealtimeDelta } from '@examplehr/contracts';

@Controller('hcm-webhook')
@UseGuards(TrustedHeadersGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @Post('batch')
  @HttpCode(202)
  async batch(@Body() body: HcmBatchPayload) {
    return this.svc.enqueueBatch(body);
  }

  @Post('realtime')
  @HttpCode(200)
  async realtime(@Body() body: HcmRealtimeDelta) {
    await this.svc.applyRealtime(body);
  }
}
