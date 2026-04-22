import { Module } from '@nestjs/common';
import { HCM_PORT } from './hcm.port';
import { HcmInMemoryAdapter } from './hcm-in-memory.adapter';
import { HcmHttpAdapter } from './hcm-http.adapter';

@Module({
  providers: [
    HcmInMemoryAdapter,
    HcmHttpAdapter,
    {
      provide: HCM_PORT,
      useFactory: (mem: HcmInMemoryAdapter, http: HcmHttpAdapter) =>
        process.env.HCM_ADAPTER === 'memory' ? mem : http,
      inject: [HcmInMemoryAdapter, HcmHttpAdapter],
    },
  ],
  exports: [HCM_PORT, HcmInMemoryAdapter],
})
export class HcmClientModule {}
