import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Workers (BullMQ processors) register on instantiation; nothing else to do here.
  process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
  process.on('SIGINT', async () => { await app.close(); process.exit(0); });
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
