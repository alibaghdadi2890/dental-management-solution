import {
  catalogSeedResultSchema,
  type DiagnosisBatch,
  diagnosisItemSchema,
  type ServiceBatch,
  serviceItemSchema,
} from '@dcm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import type { CatalogTab } from './catalog-draft';

/**
 * The clinic's catalogs. Without `tenantId` the calls address the current clinic (the session's,
 * or the one a platform admin is acting in); the admin portal passes the tenant it shows.
 */
export const catalogKeys = {
  all: ['catalog'] as const,
  tab: (tab: CatalogTab, tenantId: string | null) => ['catalog', tab, tenantId] as const,
};

const scope = (tenantId?: string) => (tenantId === undefined ? {} : { tenantId });

export const servicesQuery = (tenantId?: string) =>
  queryOptions({
    queryKey: catalogKeys.tab('services', tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/catalog/services', z.array(serviceItemSchema), scope(tenantId)),
  });

export const diagnosesQuery = (tenantId?: string) =>
  queryOptions({
    queryKey: catalogKeys.tab('diagnoses', tenantId ?? actingTenantId()),
    queryFn: () => apiFetch('/catalog/diagnoses', z.array(diagnosisItemSchema), scope(tenantId)),
  });

export function saveServices(batch: ServiceBatch) {
  return apiFetch('/catalog/services', z.array(serviceItemSchema), { method: 'PUT', json: batch });
}

export function saveDiagnoses(batch: DiagnosisBatch) {
  return apiFetch('/catalog/diagnoses', z.array(diagnosisItemSchema), {
    method: 'PUT',
    json: batch,
  });
}

export function deleteCatalogRow(tab: CatalogTab, id: string) {
  return apiFetch(`/catalog/${tab}/${id}`, z.undefined(), { method: 'DELETE' });
}

export function deactivateService(id: string) {
  return apiFetch(`/catalog/services/${id}/deactivate`, serviceItemSchema, { method: 'POST' });
}

export function deactivateDiagnosis(id: string) {
  return apiFetch(`/catalog/diagnoses/${id}/deactivate`, diagnosisItemSchema, { method: 'POST' });
}

export function seedDefaultCatalog(tenantId: string) {
  return apiFetch('/catalog/seed-default', catalogSeedResultSchema, { method: 'POST', tenantId });
}
