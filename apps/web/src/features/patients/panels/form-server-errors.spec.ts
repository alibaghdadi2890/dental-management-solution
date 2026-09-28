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

  it('puts a pending contact error on its index, with or without the patient. prefix', () => {
    expect(
      fieldErrorsOf(
        apiError(422, 'validation_failed', ['contacts.1.target.contactId'], 'not_found'),
      ),
    ).toEqual({ 'contacts.1': 'contactNotFound' });
    expect(
      fieldErrorsOf(
        apiError(422, 'validation_failed', ['patient.contacts.0.target.patientId'], 'not_found'),
      ),
    ).toEqual({ 'contacts.0': 'contactNotFound' });
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['contacts.2.target.patientId'], 'merged')),
    ).toEqual({ 'contacts.2': 'contactMerged' });
    expect(
      fieldErrorsOf(
        apiError(422, 'validation_failed', ['patient.contacts.0.target.newContact.phone']),
      ),
    ).toEqual({ 'contacts.0': 'invalidPhone' });
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['contacts.0.target.newContact.fullName'])),
    ).toEqual({ 'contacts.0': 'invalid' });
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['contacts.3.relationship']))).toEqual({
      'contacts.3': 'invalid',
    });
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['contacts.0.isGuardian']))).toEqual({
      'contacts.0': 'roleRequired',
    });
  });

  it('names a contact linked twice as a duplicate', () => {
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['patient.contacts.1'], 'duplicate')),
    ).toEqual({ 'contacts.1': 'contactDuplicate' });
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['contacts.1.target']))).toEqual({
      'contacts.1': 'contactDuplicate',
    });
  });

  it('puts linkContactId errors on the link offer, with or without the prefix', () => {
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['linkContactId'], 'not_found')),
    ).toEqual({ linkContactId: 'contactNotFound' });
    expect(
      fieldErrorsOf(apiError(422, 'validation_failed', ['patient.linkContactId'], 'not_found')),
    ).toEqual({ linkContactId: 'contactNotFound' });
    expect(fieldErrorsOf(apiError(422, 'validation_failed', ['patient.linkContactId']))).toEqual({
      linkContactId: 'contactIsPatient',
    });
  });

  it('keeps the first error of a field', () => {
    expect(
      fieldErrorsOf(
        apiError(
          422,
          'validation_failed',
          ['contacts.0.target.contactId', 'contacts.0'],
          'not_found',
        ),
      ),
    ).toEqual({ 'contacts.0': 'contactNotFound' });
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

  it('names every contact failure', () => {
    expect(failureOf(apiError(404, 'contact.not_found'))).toBe('contactNotFound');
    expect(failureOf(apiError(409, 'contact.already_linked'))).toBe('contactAlreadyLinked');
    expect(failureOf(apiError(409, 'contact.linked'))).toBe('contactLinked');
    expect(failureOf(apiError(409, 'contact.conflict'))).toBe('contactConflict');
    expect(failureOf(apiError(422, 'contact.is_patient'))).toBe('contactIsPatient');
    expect(failureOf(apiError(422, 'contact.role_required'))).toBe('contactRoleRequired');
    expect(failureOf(apiError(422, 'contact.primary_without_role'))).toBe(
      'contactPrimaryWithoutRole',
    );
  });

  it('names a link target that is merged away or gone (422 at target.…)', () => {
    expect(failureOf(apiError(422, 'validation_failed', ['target.patientId'], 'merged'))).toBe(
      'contactMerged',
    );
    expect(
      failureOf(apiError(422, 'validation_failed', ['contacts.0.target.patientId'], 'merged')),
    ).toBe('contactMerged');
    expect(failureOf(apiError(422, 'validation_failed', ['target.contactId'], 'not_found'))).toBe(
      'contactNotFound',
    );
    expect(failureOf(apiError(422, 'validation_failed', ['target.newContact.phone']))).toBe(
      'contactInvalidPhone',
    );
  });

  it('falls back on the status, never the server’s English title', () => {
    expect(failureOf(apiError(409, 'something.else'))).toBe('conflict');
    expect(failureOf(apiError(403, 'forbidden'))).toBe('forbidden');
    expect(failureOf(apiError(500, 'internal'))).toBe('unexpected');
    expect(failureOf(new Error('network'))).toBe('unexpected');
  });
});
