import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/errors/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // GlobalExceptionFilter has no injected dependencies today.
  // If a future task needs to inject (e.g., metrics), register it as a provider
  // in AppModule and replace this with: app.useGlobalFilters(app.get(GlobalExceptionFilter))
  app.useGlobalFilters(new GlobalExceptionFilter());
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ExampleHR Time-Off')
    .setDescription('Time-off microservice with HCM-as-source-of-truth integrity')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
