import { DrizzleQueryError } from 'drizzle-orm';
import { stdSerializers } from 'pino';

/** The fields of a Postgres error that identify it without echoing any value (CLAUDE.md §15). */
const PG_SAFE_FIELDS = ['code', 'constraint', 'table', 'column', 'schema', 'routine'] as const;

const MAX_CAUSE_DEPTH = 5;

interface SafeError {
  type: string;
  message: string;
  stack?: string;
  query?: string;
  cause?: SafeError | Record<string, string>;
  [field: string]: unknown;
}

function isQueryError(value: unknown): value is DrizzleQueryError {
  return value instanceof DrizzleQueryError;
}

function chainHasQueryError(error: Error): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (isQueryError(current)) return true;
    current = current.cause;
  }
  return false;
}

/** The stack frames only: the first lines of `stack` repeat the message, params included. */
function framesOnly(stack: string | undefined): string | undefined {
  return stack
    ?.split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
}

/**
 * The database driver's error as its identifying fields only: `detail`, `where` and the message
 * can carry row values (`Key (phone)=(+961…) already exists`, `invalid input syntax: "…"`).
 */
function pgCause(cause: unknown): Record<string, string> | undefined {
  if (!(cause instanceof Error)) return undefined;
  const safe: Record<string, string> = { type: cause.name };
  for (const field of PG_SAFE_FIELDS) {
    const value: unknown = (cause as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string') safe[field] = value;
  }
  return safe;
}

function safeSerialize(error: Error, depth: number): SafeError {
  if (isQueryError(error)) {
    const stack = framesOnly(error.stack);
    const cause = pgCause(error.cause);
    return {
      type: 'DrizzleQueryError',
      message: 'Failed query',
      // The SQL text has placeholders ($1, $2…), never values; the params are dropped.
      query: error.query,
      ...(stack === undefined ? {} : { stack }),
      ...(cause === undefined ? {} : { cause }),
    };
  }
  const serialized: SafeError = { type: error.name, message: error.message };
  const stack = framesOnly(error.stack);
  if (stack !== undefined) serialized.stack = `${error.name}: ${error.message}\n${stack}`;
  if (error.cause instanceof Error && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = safeSerialize(error.cause, depth + 1);
  }
  return serialized;
}

/**
 * pino's `err` serializer. Errors that involve a failed query (`DrizzleQueryError` anywhere in the
 * cause chain) lose their bound params, the "Failed query: … params: …" message and the driver's
 * value-bearing fields: params are patient data (names, phones). Everything else goes through
 * pino's standard serializer. The request id, tenant and user come from the log mixin.
 */
export function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  if (!chainHasQueryError(value)) return stdSerializers.err(value);
  return safeSerialize(value, 0);
}
