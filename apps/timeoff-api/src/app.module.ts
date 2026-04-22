import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './shared/prisma/prisma.module';
import { CorrelationMiddleware } from './shared/context/correlation.middleware';
import { pinoConfig } from './shared/logging/pino.config';
import { BalancesModule } from './modules/balances/balances.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(pinoConfig),
    PrismaModule,
    BalancesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
