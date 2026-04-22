import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './shared/prisma/prisma.module';
import { CorrelationMiddleware } from './shared/context/correlation.middleware';
import { pinoConfig } from './shared/logging/pino.config';
import { BalancesModule } from './modules/balances/balances.module';
import { HcmClientModule } from './modules/hcm-client/hcm-client.module';
import { OutboxModule } from './modules/outbox/outbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(pinoConfig),
    PrismaModule,
    BalancesModule,
    HcmClientModule,
    OutboxModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
