import { DomainError } from '../../../platform/kernel/domain-error';

/** A follow names someone who is not an active dentist of the clinic. */
export class AlertDentistInvalidError extends DomainError {
  readonly code = 'alerts.dentist_invalid';
  readonly kind = 'invalid' as const;
  constructor(dentistIds: readonly string[]) {
    super('Only active dentists of the clinic can be followed', { dentistIds });
  }
}
