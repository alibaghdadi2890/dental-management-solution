import './load-env';
import './platform/otel/register';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AuthService } from './modules/auth';
import type { AppConfig } from './platform/config/config.schema';
import { loadConfig } from './platform/config/config.schema';
import { RequestContext } from './platform/cls/request-context';
import { setupOpenApi } from './platform/http/openapi';
import { newId } from './platform/kernel/id';

/** The startup twin of `admin:bootstrap`, for hosts where a one-off command cannot be run. */
async function bootstrapPlatformAdmin(
  app: NestExpressApplication,
  config: AppConfig,
): Promise<void> {
  const email = config.BOOTSTRAP_ADMIN_EMAIL;
  const password = config.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    return;
  }
  await app
    .get(RequestContext)
    .run({ requestId: `startup:${newId()}`, actorKind: 'system' }, () =>
      app
        .get(AuthService)
        .bootstrapPlatformAdmin({ email, password, name: config.BOOTSTRAP_ADMIN_NAME }),
    );
}

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  if (config.NODE_ENV !== 'production') {
    setupOpenApi(app);
  }
  await bootstrapPlatformAdmin(app, config);
  await app.listen(config.PORT);
}

void bootstrap();
