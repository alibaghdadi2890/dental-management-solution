import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { serializeError } from './error-serializer';

const QUERY = 'insert into "patients" ("full_name", "phone") values ($1, $2)';
const PARAMS = ['Rana Haddad', '+9613123456'];

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
  const text = JSON.stringify(serialized);
  expect(text).not.toContain('Rana');
  expect(text).not.toContain('9613123456');
  expect(text).not.toContain('params');
};

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
    expect((serialized as { stack: string }).stack).toMatch(/^\s+at /);
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

  it('keeps the standard serialization for other errors', () => {
    expect(serializeError(new TypeError('boom'))).toMatchObject({
      type: 'TypeError',
      message: 'boom',
    });
    expect(serializeError('not an error')).toBe('not an error');
  });

  it('is what pino writes for `err`', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ serializers: { err: serializeError } }, sink);
    logger.error({ err: queryError(), requestId: 'req-1' }, 'Unhandled error');

    const [line] = lines;
    leaksNothing(line);
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      requestId: 'req-1',
      err: { query: QUERY, cause: { code: '23505' } },
    });
  });
});
