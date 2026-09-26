import './load-env';
import './platform/otel/register';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './platform/config/config.schema';
import { setupOpenApi } from './platform/http/openapi';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  if (config.NODE_ENV !== 'production') {
    setupOpenApi(app);
  }
  await app.listen(config.PORT);
}

void bootstrap();
