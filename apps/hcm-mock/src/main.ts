import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the frontend (or any browser-based admin tool) to hit the admin
  // endpoints directly. In production this mock would not exist; the real
  // HCM would not be browser-callable.
  app.enableCors({ origin: true, credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`hcm-mock listening on :${port}`);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
