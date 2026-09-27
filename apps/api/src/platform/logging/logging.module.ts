import { Module } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { serializeError } from './error-serializer';
import { clsLogFields, pathOnly, REDACTED_LOG_PATHS } from './log-fields';
import { REQUEST_ID_HEADER } from './request-id';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          mixin: clsLogFields,
          genReqId: (req: IncomingMessage) => String(req.headers[REQUEST_ID_HEADER]),
          redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
          serializers: {
            req: (req: IncomingMessage & { id?: unknown }) => ({
              id: req.id,
              method: req.method,
              url: pathOnly(req.url),
            }),
            res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
            err: serializeError,
          },
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.startsWith('/health') ?? false,
          },
          transport:
            config.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
