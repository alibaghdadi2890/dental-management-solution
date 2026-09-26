import type { NestExpressApplication } from '@nestjs/platform-express';
import { requestIdMiddleware } from './platform/logging/request-id';

export const API_PREFIX = 'api/v1';

/** HTTP setup shared by main.ts and end-to-end tests. */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health/live', 'health/ready'] });
  app.enableShutdownHooks();
}
