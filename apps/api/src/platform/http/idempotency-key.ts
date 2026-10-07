import { idSchema } from '@dcm/contracts';
import { ValidationFailedError } from '../kernel/validation-failed.error';

/**
 * The `Idempotency-Key` header of a mutation a client may retry (CLAUDE.md §12): a
 * client-generated uuid per submission, sent again on every retry of it. Missing or malformed →
 * 422 `validation_failed` at `Idempotency-Key`.
 */
export function idempotencyKey(value: string | undefined): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    const message = 'An Idempotency-Key header (a uuid) is required';
    throw new ValidationFailedError(message, [
      { path: 'Idempotency-Key', code: 'idempotency_key', message },
    ]);
  }
  return parsed.data;
}
