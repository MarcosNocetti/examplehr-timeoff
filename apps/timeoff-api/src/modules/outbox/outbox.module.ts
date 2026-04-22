import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';
import { OUTBOX_QUEUE, OutboxDispatcher } from './outbox-dispatcher';

@Module({
  providers: [
    OutboxRepository,
    OutboxService,
    OutboxDispatcher,
    {
      provide: OUTBOX_QUEUE,
      useFactory: () =>
        new Queue('hcm-saga', {
          connection: new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
          }),
        }),
    },
  ],
  exports: [OutboxRepository, OutboxService, OUTBOX_QUEUE],
})
export class OutboxModule {}
