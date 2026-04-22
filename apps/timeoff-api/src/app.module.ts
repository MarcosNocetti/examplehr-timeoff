import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { PrismaModule } from './shared/prisma/prisma.module';
import { CorrelationMiddleware } from './shared/context/correlation.middleware';
import { pinoConfig } from './shared/logging/pino.config';
import { BalancesModule } from './modules/balances/balances.module';
import { HcmClientModule } from './modules/hcm-client/hcm-client.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RequestsModule } from './modules/requests/requests.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(pinoConfig),
    BullModule.forRoot({
      connection: new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      }),
    }),
    BullModule.registerQueue({ name: 'hcm-saga' }),
    PrismaModule,
    BalancesModule,
    HcmClientModule,
    OutboxModule,
    RequestsModule,
    ReconciliationModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
