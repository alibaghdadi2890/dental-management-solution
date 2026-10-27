import {
  adjustmentSchema,
  agreementSchema,
  type ChangeTermsRequest,
  type CompensationReason,
  compensationReportSchema,
  compensationStatementSchema,
  type CreateAgreementRequest,
  type EndAgreement,
  type ExportLanguage,
  myMonthsSchema,
  payoutSchema,
  type RecordAdjustmentRequest,
  type RecordPayoutRequest,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/**
 * Dentist compensation (feature 13b, `compensation` module): agreements, statements, the monthly
 * report, and the dentist's own statement. Keys are scoped under the acting tenant like the
 * other features'.
 */
export const compensationKeys = {
  all: (tenantId: string | null) => ['compensation', tenantId] as const,
  agreements: (tenantId: string | null, profileId: string) =>
    [...compensationKeys.all(tenantId), 'agreements', profileId] as const,
  statement: (tenantId: string | null, profileId: string, month: string) =>
    [...compensationKeys.all(tenantId), 'statement', profileId, month] as const,
  report: (tenantId: string | null, month: string) =>
    [...compensationKeys.all(tenantId), 'report', month] as const,
  myMonths: (tenantId: string | null) =>
    [...compensationKeys.all(tenantId), 'me', 'months'] as const,
  myStatement: (tenantId: string | null, month: string) =>
    [...compensationKeys.all(tenantId), 'me', 'statement', month] as const,
};

const dentist = (profileId: string) => `/compensation/dentists/${profileId}`;
const month = (value: string) => `?${new URLSearchParams({ month: value }).toString()}`;

export function agreementsQuery(profileId: string) {
  return queryOptions({
    queryKey: compensationKeys.agreements(actingTenantId(), profileId),
    queryFn: () => apiFetch(`${dentist(profileId)}/agreements`, z.array(agreementSchema)),
  });
}

export function statementQuery(profileId: string, value: string) {
  return queryOptions({
    queryKey: compensationKeys.statement(actingTenantId(), profileId, value),
    queryFn: () =>
      apiFetch(`${dentist(profileId)}/statement${month(value)}`, compensationStatementSchema),
  });
}

export function reportQuery(value: string) {
  return queryOptions({
    queryKey: compensationKeys.report(actingTenantId(), value),
    queryFn: () => apiFetch(`/compensation/report${month(value)}`, compensationReportSchema),
  });
}

export function myMonthsQuery() {
  return queryOptions({
    queryKey: compensationKeys.myMonths(actingTenantId()),
    queryFn: () => apiFetch('/compensation/me/months', myMonthsSchema),
  });
}

export function myStatementQuery(value: string) {
  return queryOptions({
    queryKey: compensationKeys.myStatement(actingTenantId(), value),
    queryFn: () =>
      apiFetch(`/compensation/me/statement${month(value)}`, compensationStatementSchema),
  });
}

/** Every compensation read of the acting clinic, after any write. */
export function invalidateCompensation(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: compensationKeys.all(actingTenantId()) });
}

export function createAgreement(profileId: string, input: CreateAgreementRequest) {
  return apiFetch(`${dentist(profileId)}/agreements`, agreementSchema, {
    method: 'POST',
    json: input,
  });
}

export function changeTerms(profileId: string, input: ChangeTermsRequest) {
  return apiFetch(`${dentist(profileId)}/agreements/change-terms`, agreementSchema, {
    method: 'POST',
    json: input,
  });
}

export function endAgreement(profileId: string, agreementId: string, input: EndAgreement) {
  return apiFetch(`${dentist(profileId)}/agreements/${agreementId}/end`, agreementSchema, {
    method: 'POST',
    json: input,
  });
}

export function recordAdjustment(
  profileId: string,
  input: RecordAdjustmentRequest,
  idempotencyKey: string,
) {
  return apiFetch(`${dentist(profileId)}/adjustments`, adjustmentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  });
}

export function voidAdjustment(profileId: string, id: string, input: CompensationReason) {
  return apiFetch(`${dentist(profileId)}/adjustments/${id}/void`, adjustmentSchema, {
    method: 'POST',
    json: input,
  });
}

export function recordPayout(
  profileId: string,
  input: RecordPayoutRequest,
  idempotencyKey: string,
) {
  return apiFetch(`${dentist(profileId)}/payouts`, payoutSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  });
}

export function voidPayout(profileId: string, id: string, input: CompensationReason) {
  return apiFetch(`${dentist(profileId)}/payouts/${id}/void`, payoutSchema, {
    method: 'POST',
    json: input,
  });
}

export function closeMonth(profileId: string, value: string) {
  return apiFetch(`${dentist(profileId)}/periods/${value}/close`, compensationStatementSchema, {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
  });
}

export function reopenMonth(profileId: string, value: string, input: CompensationReason) {
  return apiFetch(`${dentist(profileId)}/periods/${value}/reopen`, compensationStatementSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
  });
}

const exportQuery = (value: string, lang: ExportLanguage | undefined) =>
  `?${new URLSearchParams({ month: value, ...(lang ? { lang } : {}) }).toString()}`;

export function downloadReport(value: string, lang: ExportLanguage | undefined): Promise<void> {
  return downloadCsv(
    `/compensation/report/export${exportQuery(value, lang)}`,
    `compensation-${value}.csv`,
  );
}

export function downloadStatement(
  profileId: string,
  value: string,
  lang: ExportLanguage | undefined,
): Promise<void> {
  return downloadCsv(
    `${dentist(profileId)}/statement/export${exportQuery(value, lang)}`,
    `statement-${value}.csv`,
  );
}
