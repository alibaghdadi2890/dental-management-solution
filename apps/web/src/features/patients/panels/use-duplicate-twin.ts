import { isoDateSchema, nameSchema, type PatientListItem } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { duplicateCheckQuery } from '../patients-api';

const DUPLICATE_CHECK_DELAY = 300;
const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/**
 * The create/edit panel's "possible duplicate" (design §Right panel): once the typed name and
 * date of birth have settled and are both valid, `GET /patients/duplicates/check` for another
 * active patient with the same name key and date of birth — the record being edited excluded.
 * Returns the first match, or `undefined`.
 */
export function useDuplicateTwin({
  fullName,
  dateOfBirth,
  excludeId,
  today,
}: {
  fullName: string;
  dateOfBirth: string;
  excludeId: string | undefined;
  today: string;
}): PatientListItem | undefined {
  const name = useDebouncedValue(fullName.trim(), DUPLICATE_CHECK_DELAY);
  const dob = useDebouncedValue(dateOfBirth, DUPLICATE_CHECK_DELAY);
  const checkable =
    nameSchema.safeParse(name).success &&
    isoDateSchema.safeParse(dob).success &&
    dob <= today &&
    dob >= DATE_OF_BIRTH_FLOOR;
  const duplicates = useQuery({
    ...duplicateCheckQuery({ fullName: name, dateOfBirth: dob, excludeId }),
    enabled: checkable,
  });
  return checkable ? duplicates.data?.[0] : undefined;
}
