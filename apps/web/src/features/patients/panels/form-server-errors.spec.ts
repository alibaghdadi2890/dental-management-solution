import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { failureOf, fieldErrorsOf } from './form-server-errors';

const apiError = (status: number, code: string, paths: string[] = [], issueCode = 'custom') =>
  new ApiError({
    type: 'about:blank',
    title: 'English title from the server',
    status,
    code,
    ...(paths.length > 0
      ? { errors: paths.map((path) => ({ path, code: issueCode, message: 'Invalid' })) }
      : {}),
  });

describe('fieldErrorsOf', () => {
  it('maps patient paths, with or without the opening-balance route’s prefix', () => {
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['phone']))).toEqual({
      phone: 'invalidPhone',
    });
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['patient.email', 'patient.address'])),
    ).toEqual({ email: 'invalidEmail', address: 'invalid' });
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['patient.medicalAlerts.3']))).toEqual({
      alerts: 'invalid',
    });
  });

  it("puts the phone rule's missing phone as Required, not as an invalid number", () => {
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['phone'], 'required'))).toEqual({
      phone: 'required',
    });
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['patient.phone'], 'required')),
    ).toEqual({ phone: 'required' });
  });

  it('maps opening-balance paths to the Account fields', () => {
    expect(
      fieldErrorsOf(
        apiError(422, 'validation_failed', [
          'openingBalance.amount',
          'openingBalance.asOf',
          'openingBalance.note',
        ]),
      ),
    ).toEqual({
      openingBalanceAmount: 'invalidAmount',
      openingBalanceAsOf: 'invalid',
      openingBalanceNote: 'invalid',
    });
  });

  it('puts an unknown dentist on the dentist field', () => {
    expect(fieldErrorsOf(apiError(422, 'patient.unknown_dentist'))).toEqual({
      primaryDentistId: 'unknownDentist',
    });
  });

  it('is null when nothing maps to a field', () => {
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['somethingElse']))).toBeNull();
    expect(fieldErrorsOf(apiError(409, 'patient.archived'))).toBeNull();
    expect(fieldErrorsOf(new Error('network'))).toBeNull();
  });
});

describe('failureOf', () => {
  it('names the phone rule for a 422 on phone with code required', () => {
    expect(failureOf(apiError(422, 'validation_failed', ['phone'], 'required'))).toBe(
      'phoneRequired',
    );
    expect(failureOf(apiError(422, 'validation_failed', ['phone'], 'invalid_phone'))).toBe(
      'unexpected',
    );
  });

  it('names the known patient failures', () => {
    expect(failureOf(apiError(409, 'patient.archived'))).toBe('archived');
    expect(failureOf(apiError(409, 'patient.merged'))).toBe('merged');
    expect(failureOf(apiError(422, 'patient.merge_alerts_overflow'))).toBe('alertsOverflow');
    expect(failureOf(apiError(422, 'patient.unknown_dentist'))).toBe('unknownDentist');
    expect(failureOf(apiError(404, 'patient.not_found'))).toBe('notFound');
  });

  it('falls back on the status, never the server’s English title', () => {
    expect(failureOf(apiError(409, 'something.else'))).toBe('conflict');
    expect(failureOf(apiError(403, 'forbidden'))).toBe('forbidden');
    expect(failureOf(apiError(500, 'internal'))).toBe('unexpected');
    expect(failureOf(new Error('network'))).toBe('unexpected');
  });
});
