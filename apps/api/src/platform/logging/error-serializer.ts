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

/**
 * The stack frames only. V8 starts `stack` with `String(error)` (`Name: message`), and the
 * message of a failed query holds its params, which may themselves contain newlines and text
 * shaped like a frame; so the header is cut by its exact length, never by guessing which lines
 * look like frames. A stack that does not start with the header (a message changed after the
 * error was created) is dropped rather than risked.
 */
function framesOnly(error: Error): string | undefined {
  const header = String(error);
  const stack = error.stack;
  if (stack === undefined || !stack.startsWith(header)) return undefined;
  const frames = stack.slice(header.length).replace(/^\n/, '');
  return frames === '' ? undefined : frames;
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
  const frames = framesOnly(error);
  if (isQueryError(error)) {
    const cause = pgCause(error.cause);
    return {
      type: 'DrizzleQueryError',
      message: 'Failed query',
      // The SQL text has placeholders ($1, $2…), never values; the params are dropped.
      query: error.query,
      ...(frames === undefined ? {} : { stack: frames }),
      ...(cause === undefined ? {} : { cause }),
    };
  }
  const serialized: SafeError = { type: error.name, message: error.message };
  if (frames !== undefined) serialized.stack = `${String(error)}\n${frames}`;
  if (error.cause instanceof Error && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = safeSerialize(error.cause, depth + 1);
  }
  return serialized;
}

/**
 * The error behind `value`: the value itself, or — since pino-http wraps custom serializers with
 * pino's standard one (`wrapSerializers`) — the original kept on the standard result's `.raw`.
 */
function originalError(value: unknown): Error | undefined {
  if (value instanceof Error) return value;
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const raw: unknown = value.raw;
    if (raw instanceof Error) return raw;
  }
  return undefined;
}

/**
 * pino's `err` serializer. Errors that involve a failed query (`DrizzleQueryError` anywhere in the
 * cause chain) lose their bound params, the "Failed query: … params: …" message and the driver's
 * value-bearing fields: params are patient data (names, phones). Everything else keeps pino's
 * standard serialization. The request id, tenant and user come from the log mixin.
 */
export function serializeError(value: unknown): unknown {
  const error = originalError(value);
  if (error === undefined) return value;
  if (chainHasQueryError(error)) return safeSerialize(error, 0);
  return value instanceof Error ? stdSerializers.err(value) : value;
}
