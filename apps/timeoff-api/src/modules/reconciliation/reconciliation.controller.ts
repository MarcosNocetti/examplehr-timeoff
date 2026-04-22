import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../shared/auth/trusted-headers.guard';
import { ReconciliationService } from './reconciliation.service';
import { CurrentUser, CurrentUserPayload } from '../../shared/auth/current-user.decorator';
import { ForbiddenError } from '../../shared/errors/domain.errors';
import { Role, HcmBatchPayload, HcmRealtimeDelta } from '@examplehr/contracts';

@Controller('hcm-webhook')
@UseGuards(TrustedHeadersGuard)
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @Post('batch')
  @HttpCode(202)
  async batch(@Body() body: HcmBatchPayload, @CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.ADMIN) throw new ForbiddenError();
    return this.svc.enqueueBatch(body);
  }

  @Post('realtime')
  @HttpCode(200)
  async realtime(@Body() body: HcmRealtimeDelta, @CurrentUser() user: CurrentUserPayload) {
    if (user.role !== Role.ADMIN) throw new ForbiddenError();
    await this.svc.applyRealtime(body);
  }
}
