import { MERGE_FIELDS, type MergeField, type Patient, type Session } from '@dcm/contracts';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { formatCalendarDate, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PatientPanel } from '../list-query';
import {
  alertsOverflow,
  differingFields,
  type MergeDraft,
  mergeDraft,
  preview,
  swapKeep,
  toMergePayload,
} from '../merge-draft';
import { invalidatePatientData, mergePatients, patientQuery } from '../patients-api';
import { PanelFallback } from './panel-fallback';

type Tenant = NonNullable<Session['tenant']>;
type Side = 'a' | 'b';

const NONE = '—';
const GRID = 'grid grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]';

/**
 * Merge duplicates (`Patients.dc.html` merge panel, design §Right panel): a compare grid of the
 * fields the two records disagree on, one radio per row (defaulting to the kept record's value),
 * the "Keep ID" choice in the header row, and the medical alerts shown as the union both records
 * keep (Q8, never picked). Confirming asks for a reason in the POC's confirm dialog.
 */
export function MergePanel({
  ids,
  tenant,
  onClose,
  onOpen,
}: {
  ids: readonly [string, string];
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const [a, b] = useQueries({ queries: [patientQuery(ids[0]), patientQuery(ids[1])] });
  if (!a.data || !b.data) {
    return (
      <PanelFallback
        eyebrow={t('merge.eyebrow')}
        error={a.error ?? b.error}
        onRetry={() => {
          void a.refetch();
          void b.refetch();
        }}
        onClose={onClose}
      />
    );
  }
  if (a.data.archivedAt !== null || b.data.archivedAt !== null) {
    return (
      <RightPanel
        eyebrow={t('merge.eyebrow')}
        title={t('merge.title')}
        dirty={false}
        onClose={onClose}
      >
        <p role="alert" className="text-[13px] leading-normal text-ink-secondary">
          {t('merge.unavailable')}
        </p>
      </RightPanel>
    );
  }
  return (
    <MergeEditor
      key={`${a.data.id},${b.data.id}`}
      a={a.data}
      b={b.data}
      tenant={tenant}
      onClose={onClose}
      onOpen={onOpen}
    />
  );
}

/** A new survivor starts from its own values again, as in the POC ("Keep ID" resets the picks). */
function keepOther(draft: MergeDraft): MergeDraft {
  const swapped = swapKeep(draft);
  const choices: MergeDraft['choices'] = {};
  for (const field of Object.keys(draft.choices) as MergeField[]) choices[field] = 'keep';
  return { ...swapped, choices };
}

function MergeEditor({
  a,
  b,
  tenant,
  onClose,
  onOpen,
}: {
  a: Patient;
  b: Patient;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { names } = useStaffNames();
  const name = useId();
  const [draft, setDraft] = useState(() => mergeDraft(a, b));

  const keepsA = draft.keepId === a.id;
  const kept = keepsA ? a : b;
  const dropped = keepsA ? b : a;
  const fields = differingFields(a, b);
  const result = preview(draft);
  const overflow = alertsOverflow(draft);
  const hasAlerts = a.medicalAlerts.length > 0 || b.medicalAlerts.length > 0;

  const valueOf = (patient: Patient, field: MergeField): string => {
    switch (field) {
      case 'phone':
        return formatPhone(patient.phone, tenant.country);
      case 'dateOfBirth':
        return patient.dateOfBirth ? formatCalendarDate(patient.dateOfBirth, locale) : NONE;
      case 'sex':
        return patient.sex === 'unknown' ? NONE : t(`quickView.sex.${patient.sex}`);
      case 'primaryDentistUserId':
        return patient.primaryDentistUserId
          ? (names.get(patient.primaryDentistUserId) ?? t('quickView.unknownDentist'))
          : NONE;
      case 'guardian': {
        const parts = [
          patient.guardianName,
          patient.guardianPhone && formatPhone(patient.guardianPhone, tenant.country),
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(' · ') : NONE;
      }
      default:
        return patient[field] ?? NONE;
    }
  };

  // `'keep'` means the survivor's value, so which column a choice lands in depends on the survivor.
  const picked = (field: MergeField): Side =>
    (draft.choices[field] !== 'drop') === keepsA ? 'a' : 'b';
  const pick = (field: MergeField, side: Side) => {
    setDraft((current) => ({
      ...current,
      choices: { ...current.choices, [field]: (side === 'a') === keepsA ? 'keep' : 'drop' },
    }));
  };

  const failure = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'patient.archived') return t('merge.failedArchived');
      if (error.code === 'patient.merged') return t('merge.failedMerged');
      if (error.code === 'patient.merge_alerts_overflow') return t('merge.failedOverflow');
      return t('merge.failed', { reason: error.problem.title });
    }
    return t('merge.failed', { reason: t('common:unexpected') });
  };

  const submit = () => {
    const keptId = draft.keepId;
    confirm({
      title: t('merge.confirmTitle', { drop: dropped.displayNumber, keep: kept.displayNumber }),
      body: t('merge.confirmBody'),
      okLabel: t('merge.submit'),
      tone: 'danger',
      reasonLabel: t('merge.reason'),
      onConfirm: async (reason) => {
        try {
          await mergePatients(toMergePayload(draft, reason));
        } catch (error) {
          throw new Error(failure(error), { cause: error });
        }
        void invalidatePatientData(queryClient);
        toast(t('merge.done'));
        onOpen({ kind: 'quick', id: keptId });
      },
    });
  };

  const cell = (on: boolean) =>
    cn(
      'block cursor-pointer border-s border-row-divider p-2.5 text-start text-[12.5px] leading-[1.35] [overflow-wrap:anywhere] has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring',
      on
        ? 'bg-primary-tint font-medium text-ink shadow-[inset_3px_0_0_var(--color-primary)] rtl:shadow-[inset_-3px_0_0_var(--color-primary)]'
        : 'bg-surface text-ink-muted',
    );

  return (
    <RightPanel
      eyebrow={t('merge.eyebrow')}
      title={t('merge.title')}
      dirty={false}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="dangerSolid" disabled={overflow} onClick={submit}>
            {t('merge.submit')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-normal text-ink-secondary">{t('merge.intro')}</p>

      <div className="overflow-hidden rounded-[9px] border border-border">
        <div role="radiogroup" aria-label={t('merge.keepGroup')} className={GRID}>
          <span className="border-b border-border bg-faint px-2.5 py-[9px]" />
          {[a, b].map((patient) => {
            const on = patient.id === draft.keepId;
            return (
              <label
                key={patient.id}
                className={cn(
                  'cursor-pointer border-s border-b border-border px-2.5 py-[9px] has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring',
                  on ? 'bg-primary-tint text-primary' : 'bg-faint text-ink',
                )}
              >
                <input
                  type="radio"
                  name={`${name}-keep`}
                  checked={on}
                  onChange={() => {
                    setDraft(keepOther);
                  }}
                  className="sr-only"
                />
                <span className="block text-[12.5px] leading-[1.3] font-semibold">
                  {on ? t('merge.keep') : t('merge.mergeInto')}
                </span>{' '}
                <span
                  dir="ltr"
                  className="block font-mono text-[11.5px] leading-[1.3] text-ink-muted"
                >
                  {patient.displayNumber}
                </span>
              </label>
            );
          })}
        </div>

        {fields.map((field) => {
          const label = t(`merge.fields.${field}`);
          return (
            <div
              key={field}
              role="radiogroup"
              aria-label={label}
              className={cn(GRID, 'border-t border-row-divider')}
            >
              <span className="p-2.5 text-[12.5px] leading-[1.3] text-ink-muted">{label}</span>
              {(['a', 'b'] as const).map((side) => {
                const patient = side === 'a' ? a : b;
                const on = picked(field) === side;
                return (
                  <label key={side} className={cell(on)}>
                    <input
                      type="radio"
                      name={`${name}-${field}`}
                      aria-label={t('merge.valueFor', {
                        field: label,
                        number: patient.displayNumber,
                      })}
                      checked={on}
                      onChange={() => {
                        pick(field, side);
                      }}
                      className="sr-only"
                    />
                    <span dir={field === 'phone' ? 'ltr' : undefined}>
                      {valueOf(patient, field)}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}

        {hasAlerts && (
          <div className="grid grid-cols-[96px_minmax(0,1fr)] border-t border-row-divider">
            <span className="p-2.5 text-[12.5px] leading-[1.3] text-ink-muted">
              {t('merge.fields.alerts')}
            </span>
            <div className="border-s border-row-divider p-2.5">
              <ul
                aria-label={t('merge.fields.alerts')}
                className="m-0 flex list-none flex-wrap gap-1.5 p-0"
              >
                {result.medicalAlerts.map((alert) => (
                  <li
                    key={alert}
                    className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-[11.5px] leading-none font-medium text-danger"
                  >
                    {alert}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-snug text-ink-muted">{t('merge.alertsKept')}</p>
            </div>
          </div>
        )}
      </div>

      {overflow && (
        <p
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
        >
          {t('merge.overflow')}
        </p>
      )}

      <p className="text-[12.5px] leading-normal text-ink-secondary">
        {MERGE_FIELDS.length > fields.length &&
          `${t('merge.matching', { count: MERGE_FIELDS.length - fields.length })} `}
        {t('merge.summary', { drop: dropped.displayNumber, keep: kept.displayNumber })}
      </p>
    </RightPanel>
  );
}
