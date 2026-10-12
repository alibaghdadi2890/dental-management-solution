import {
  type MedicalHistoryInput,
  type Patient,
  toMedicalHistoryInput,
  type Visit,
} from '@dcm/contracts';
import { MutationObserver, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { HistoryFields } from '@/features/patients/medical-history/history-fields';
import { sameHistory } from '@/features/patients/medical-history/history-model';
import { patientKeys, updatePatient } from '@/features/patients/patients-api';
import { useActingTenantId } from '@/features/platform/acting-tenant';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useVisitMutations } from '../visit-mutations';
import { historyConfirmationQuery } from '../visits-api';

/**
 * Intake's **Medical history** card (feature 10, V3; ADR-0046): the allergy and condition chips
 * and the medication line, saved as they change — the history is the patient's, so the header
 * chips follow at once — and one **Confirmed with the patient** checkbox. Ticked, it reads
 * "Confirmed by {dentist} · {time}" and the card turns green; while no dentist has ever confirmed
 * this patient's history, an amber "Registered by front desk · not confirmed" line says so.
 * Editing needs `patient:write`, confirming `chart:write`; both need a live visit.
 */
export function HistoryCard({
  visit,
  patient,
  canWrite,
}: {
  visit: Visit;
  patient: Patient;
  /** `visit:write` on a live visit. */
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation(['clinical', 'patients']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  const timeZone = useSession().data?.tenant?.timeZone ?? 'UTC';
  const canEdit = usePermission('patient:write') && canWrite;
  const canConfirm = usePermission('chart:write') && canWrite;
  const mutations = useVisitMutations(visit.id);
  const confirm = useMutation(mutations.confirmHistory);
  const everConfirmed = useQuery(historyConfirmationQuery(visit.patientId));

  const stored = toMedicalHistoryInput(patient.medicalHistory);
  // What is shown ahead of the patient that answers it; dropped once they agree.
  const [draft, setDraft] = useState<MedicalHistoryInput | null>(null);
  if (draft !== null && sameHistory(draft, stored)) setDraft(null);
  const value = draft ?? stored;

  const save = (next: MedicalHistoryInput) => {
    // One at a time, in order (`scope`): the last chip clicked is the last one stored.
    new MutationObserver(queryClient, {
      scope: { id: `medical-history:${patient.id}` },
      mutationFn: (history: MedicalHistoryInput) =>
        updatePatient(patient.id, { medicalHistory: history }),
    })
      .mutate(next)
      .then((saved) => {
        queryClient.setQueryData(patientKeys.detail(tenantId, saved.id), saved);
      })
      .catch((error: unknown) => {
        setDraft(null);
        toast(t('flow.history.saveFailed', { reason: apiErrorMessage(error, i18n) }), {
          tone: 'danger',
        });
      });
  };

  const confirmation = visit.historyConfirmation;
  const confirmed = confirmation !== null;
  const neverConfirmed = !confirmed && everConfirmed.data?.confirmation === null;

  return (
    <section
      aria-label={t('flow.history.title')}
      data-confirmed={confirmed || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-surface px-5 py-[18px]',
        confirmed ? 'border-success shadow-[0_0_0_1px_var(--color-success)]' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="m-0 text-[14px] leading-none font-semibold">{t('flow.history.title')}</h2>
        {neverConfirmed && (
          <span className="inline-flex items-center gap-1.5 text-[12px] leading-none font-medium text-warning">
            <span aria-hidden className="size-1.5 rounded-full bg-warning-dot" />
            {t('flow.history.unconfirmed')}
          </span>
        )}
      </div>
      <HistoryFields
        value={value}
        stored={patient.medicalHistory}
        disabled={!canEdit}
        commitMedicationOnBlur
        onChange={(next) => {
          setDraft(next);
          save(next);
        }}
      />
      <label
        className={cn(
          'flex items-start gap-2.5 rounded-[9px] border px-3.5 py-3',
          confirmed ? 'border-success-border bg-success-bg' : 'border-border bg-faint',
          canConfirm ? 'cursor-pointer' : 'opacity-80',
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!canConfirm || confirm.isPending}
          onChange={(event) => {
            confirm.mutate(event.target.checked, {
              onError: (error) => {
                toast(t('flow.history.confirmFailed', { reason: apiErrorMessage(error, i18n) }), {
                  tone: 'danger',
                });
              },
            });
          }}
          className="m-0 size-[18px] flex-none accent-success"
        />
        <span className="flex-1">
          <span className="block text-[13px] leading-[1.35] font-semibold">
            {t('flow.history.confirm')}
          </span>
          {confirmation && (
            <span className="mt-1 block text-[12px] leading-[1.35] text-success">
              {t('flow.history.confirmedBy', {
                name: confirmation.byName,
                time: formatTime(confirmation.at, { timeZone, locale }),
              })}
            </span>
          )}
        </span>
      </label>
    </section>
  );
}
