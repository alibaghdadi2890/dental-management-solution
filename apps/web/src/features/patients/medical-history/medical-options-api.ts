import {
  type MedicalOptionAdd,
  type MedicalOptionBatch,
  medicalOptionSchema,
  medicalOptionSeedResultSchema,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * A clinic's allergy and condition lists (`/medical-history/options`): read by every form that
 * shows a medical history, which adds the names typed in it; edited from the Catalog.
 */
export const medicalOptionKeys = {
  all: ['medical-options'] as const,
  list: (tenantId: string | null) => ['medical-options', tenantId] as const,
};

const optionsSchema = z.array(medicalOptionSchema);

export const medicalOptionsQuery = () =>
  queryOptions({
    queryKey: medicalOptionKeys.list(actingTenantId()),
    queryFn: () => apiFetch('/medical-history/options', optionsSchema),
    // The lists change from the Catalog and from a name typed in a history; both write this
    // cache themselves.
    staleTime: 5 * 60_000,
  });

/** The option of this name in its list: the one already there, else a new one. */
export function addMedicalOption(input: MedicalOptionAdd) {
  return apiFetch('/medical-history/options', medicalOptionSchema, { method: 'POST', json: input });
}

export function saveMedicalOptions(batch: MedicalOptionBatch) {
  return apiFetch('/medical-history/options', optionsSchema, { method: 'PUT', json: batch });
}

export function deleteMedicalOption(id: string) {
  return apiFetch(`/medical-history/options/${id}`, z.undefined(), { method: 'DELETE' });
}

export function deactivateMedicalOption(id: string) {
  return apiFetch(`/medical-history/options/${id}/deactivate`, medicalOptionSchema, {
    method: 'POST',
  });
}

export function seedMedicalOptions() {
  return apiFetch('/medical-history/options/seed-default', medicalOptionSeedResultSchema, {
    method: 'POST',
  });
}
