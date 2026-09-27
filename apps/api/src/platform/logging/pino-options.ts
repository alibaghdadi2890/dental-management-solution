import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import type { AppConfig } from '../config/config.schema';
import { serializeError } from './error-serializer';
import { clsLogFields, pathOnly, REDACTED_LOG_PATHS } from './log-fields';
import { REQUEST_ID_HEADER } from './request-id';

/**
 * The pino-http options `LoggingModule` builds the app logger from; exported so tests build the
 * very same logger. pino-http wraps these serializers with pino's standard ones (its default
 * `wrapSerializers`), so each receives the standard serialization, with the original on `.raw`.
 */
export function pinoHttpOptions(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Options {
  return {
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
  };
}
