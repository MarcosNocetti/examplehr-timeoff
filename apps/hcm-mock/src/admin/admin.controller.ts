import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { HcmStore, FailureSpec } from '../hcm/hcm.store';

@Controller('_admin')
export class AdminController {
  constructor(private readonly store: HcmStore) {}

  @Post('seed')
  @HttpCode(204)
  seed(@Body() body: { employeeId: string; locationId: string; totalDays: string }) {
    this.store.seed(body.employeeId, body.locationId, body.totalDays);
  }

  @Post('reset')
  @HttpCode(204)
  reset() { this.store.reset(); }

  @Post('inject-failure')
  @HttpCode(204)
  inject(@Body() body: FailureSpec) { this.store.injectFailure(body); }
}
