import { Module } from '@nestjs/common';
import { HcmStore } from './hcm/hcm.store';
import { HcmService } from './hcm/hcm.service';
import { HcmController } from './hcm/hcm.controller';
import { AdminController } from './admin/admin.controller';

@Module({
  controllers: [HcmController, AdminController],
  providers: [HcmStore, HcmService],
})
export class AppModule {}
