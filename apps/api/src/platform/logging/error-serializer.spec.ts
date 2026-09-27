import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import pinoHttp from 'pino-http';
import { describe, expect, it } from 'vitest';
import { serializeError } from './error-serializer';
import { pinoHttpOptions } from './pino-options';

const QUERY = 'insert into "patients" ("full_name", "phone", "notes") values ($1, $2, $3)';
/** A note shaped like a stack frame must not survive as one. */
const PARAMS = ['Rana Haddad', '+9613123456', 'Toothache\n    at home since Monday'];

/** What node-postgres throws for a unique violation: `detail` echoes the conflicting values. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
    name: 'DatabaseError',
    code: '23505',
    constraint: 'patients_display_number_unique',
    table: 'patients',
    detail: 'Key (phone)=(+9613123456) already exists.',
  });
}

function queryError(): DrizzleQueryError {
  return new DrizzleQueryError(QUERY, PARAMS, uniqueViolation());
}

const leaksNothing = (serialized: unknown) => {
  const text = typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
  expect(text).not.toContain('Rana');
  expect(text).not.toContain('9613123456');
  expect(text).not.toContain('home since Monday');
  expect(text).not.toContain('params');
};

/** The app's logger, built exactly as `LoggingModule` builds it, writing to memory. */
function appLogger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const { logger } = pinoHttp(pinoHttpOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), sink);
  return { logger, lines };
}

describe('serializeError', () => {
  it('logs a failed query as its SQL text and the driver error code, without params', () => {
    const serialized = serializeError(queryError());
    leaksNothing(serialized);
    expect(serialized).toMatchObject({
      type: 'DrizzleQueryError',
      message: 'Failed query',
      query: QUERY,
      cause: {
        type: 'DatabaseError',
        code: '23505',
        constraint: 'patients_display_number_unique',
        table: 'patients',
      },
    });
    const stack = (serialized as { stack: string }).stack;
    expect(stack.split('\n').every((line) => /^\s+at /.test(line))).toBe(true);
    expect(stack).toContain('error-serializer.spec');
  });

  it('strips a failed query wrapped by another error', () => {
    const wrapped = new Error('create failed', { cause: queryError() });
    const serialized = serializeError(wrapped);
    leaksNothing(serialized);
    expect(serialized).toMatchObject({
      type: 'Error',
      message: 'create failed',
      cause: { type: 'DrizzleQueryError', query: QUERY, cause: { code: '23505' } },
    });
  });

  it("unwraps pino's standard serialization (pino-http wraps custom serializers)", () => {
    const standard = { type: 'Error', message: 'Failed query: …', raw: queryError() };
    const serialized = serializeError(standard);
    leaksNothing(serialized);
    expect(serialized).toMatchObject({ type: 'DrizzleQueryError', query: QUERY });
  });

  it('keeps the standard serialization for other errors', () => {
    expect(serializeError(new TypeError('boom'))).toMatchObject({
      type: 'TypeError',
      message: 'boom',
    });
    expect(serializeError('not an error')).toBe('not an error');
  });
});

describe('the app logger', () => {
  it('never writes query params, names or phones for a failed query', () => {
    const { logger, lines } = appLogger();
    logger.error({ err: queryError() }, 'Unhandled error');
    logger.error({ err: new Error('create failed', { cause: queryError() }) }, 'Wrapped');

    expect(lines).toHaveLength(2);
    for (const line of lines) leaksNothing(line);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      msg: 'Unhandled error',
      err: { type: 'DrizzleQueryError', query: QUERY, cause: { code: '23505' } },
    });
  });

  it('still logs other errors in full', () => {
    const { logger, lines } = appLogger();
    logger.error({ err: new TypeError('boom') }, 'Other');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      err: { type: 'TypeError', message: 'boom' },
    });
  });
});
