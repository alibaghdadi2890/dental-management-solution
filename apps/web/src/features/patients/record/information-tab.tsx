import { type Patient, profileCompleteness, type Session } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SaveState, type SaveStatus } from '@/components/ui/save-state';
import { useToast } from '@/components/ui/toast-context';
import { type GuardLocation, UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { usePermission } from '@/features/auth/use-permission';
import { cn } from '@/lib/utils';
import { failureOf, fieldErrorsOf } from '../panels/form-server-errors';
import { fromPatient, isEditDirty, type PatientFormValues, toPatchPayload } from '../patient-form';
import { PatientField, type PatientFieldName } from '../patient-form-fields';
import { invalidatePatientData, patientQuery, updatePatient } from '../patients-api';
import { usePatientForm } from '../use-patient-form';
import { parseRecordSearch } from './record-search';

type Tenant = NonNullable<Session['tenant']>;

/** How long "Saved just now" stays before the indicator goes quiet again. */
export const SAVED_SHOWN_MS = 5000;

/** Leaving the tab — for the other tab or another screen — leaves the form. */
const leavesTab = (current: GuardLocation, next: GuardLocation) =>
  current.pathname !== next.pathname ||
  parseRecordSearch(current.search).tab !== parseRecordSearch(next.search).tab;

type Phase = 'idle' | 'saving' | 'saved' | 'failed';

function CompletenessBadge({ patient }: { patient: Patient }) {
  const { t } = useTranslation('patients');
  const complete = profileCompleteness(patient) === 'complete';
  return (
    <span
      className={cn(
        'rounded-[5px] border px-2 py-[3px] text-[12.5px] leading-none font-medium whitespace-nowrap',
        complete
          ? 'border-success-border bg-success-bg text-success'
          : 'border-warning-border bg-warning-bg text-warning',
      )}
    >
      {complete ? t('record.form.complete') : t('record.form.partial')}
    </span>
  );
}

/**
 * The record's Patient information tab (workspace spec §Tab: Patient information, design Q16):
 * the whole patient form — the edit panel's model and fields, phone rule included — with its
 * completeness badge, Save changes, and the save-state indicator (which also confirms a save: no
 * toast). A failed save keeps what was typed and retries from the indicator; leaving the tab or
 * the record while dirty asks first.
 *
 * Read-only without `patient:write`, and for an archived (or merged) record: the server would
 * refuse the save. One archived elsewhere while this form holds unsaved edits keeps the form and
 * the edits (as the edit panel does), with a warning and Save turned off — nothing typed is
 * silently replaced.
 */
export function InformationTab({ patient, tenant }: { patient: Patient; tenant: Tenant }) {
  const { t } = useTranslation(['patients', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('patient:write');
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const form = usePatientForm(() => fromPatient(patient, tenant.country), tenant, formRef, 'edit');
  const { initial, values, country } = form;
  const [phase, setPhase] = useState<Phase>('idle');
  const saving = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const archived = patient.archivedAt !== null;
  const dirty = isEditDirty(initial, values, country);
  // Archived with nothing typed: nothing to lose, so the form turns read-only.
  const readOnly = !canWrite || (archived && !dirty);
  // Archived under unsaved edits: they stay, editable, but can't be saved.
  const keptEdits = canWrite && archived && dirty;
  const blocked = readOnly || !dirty || archived || phase === 'saving';

  // The record changed underneath (a refetch, another tab's save): an untouched form follows it.
  // A dirty one keeps its base until it is clean again, so undoing the edits shows the latest.
  const [basedOn, setBasedOn] = useState(patient.updatedAt);
  if (patient.updatedAt !== basedOn && phase !== 'saving' && !dirty) {
    setBasedOn(patient.updatedAt);
    form.reset(fromPatient(patient, country));
  }
  // A failure is about edits that are gone once the form is clean again.
  if (phase === 'failed' && !dirty) setPhase('idle');

  // "Saved just now" goes quiet after a while (and as soon as the form is edited again).
  useEffect(() => {
    if (phase !== 'saved') return;
    const timer = setTimeout(() => {
      setPhase('idle');
    }, SAVED_SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);

  const status: SaveStatus =
    phase === 'saving'
      ? 'saving'
      : dirty
        ? phase === 'failed' && !archived
          ? 'failed'
          : 'dirty'
        : phase === 'saved'
          ? 'saved'
          : 'clean';

  const submit = async () => {
    if (saving.current || blocked) return;
    if (!form.check()) return;
    const patch = toPatchPayload(initial, values, country);
    if (!patch) return;
    const submitted: PatientFormValues = values;
    saving.current = true;
    setPhase('saving');
    try {
      const updated = await updatePatient(patient.id, patch);
      queryClient.setQueryData(patientQuery(patient.id).queryKey, updated);
      void invalidatePatientData(queryClient);
      if (!mounted.current) return;
      setBasedOn(updated.updatedAt);
      form.rebase(fromPatient(updated, country), submitted);
      setPhase('saved');
    } catch (error) {
      const failure = failureOf(error);
      // Archived meanwhile: reload the record, so the form says why (and keeps the edits).
      if (failure === 'archived' || failure === 'merged') void invalidatePatientData(queryClient);
      if (!mounted.current) return;
      const fields = fieldErrorsOf(error);
      if (fields) {
        form.showServerErrors(fields);
        setPhase('idle');
        return;
      }
      setPhase('failed');
      toast(t('form.failed', { reason: t(`failures.${failure}`) }), { tone: 'danger' });
    } finally {
      saving.current = false;
    }
  };

  const field = (name: PatientFieldName, className?: string) => (
    <PatientField form={form} name={name} variant="page" className={className} />
  );

  return (
    <section
      aria-labelledby={titleId}
      className="max-w-[760px] rounded-xl border border-border bg-surface px-[22px] py-5"
    >
      {/* A save in flight is not held back: those edits are already on their way to the server. */}
      <UnsavedChangesGuard when={dirty && phase !== 'saving'} isLeaving={leavesTab} />
      <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('record.form.title')}
        </h2>
        <CompletenessBadge patient={patient} />
      </div>
      <p className="mb-5 text-[12.5px] leading-normal text-ink-muted">{t('record.form.intro')}</p>
      {archived && !dirty && (
        <p
          role="note"
          className="mb-4 rounded-lg border border-border bg-faint px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-secondary"
        >
          {patient.mergedIntoId === null ? t('record.form.archived') : t('record.form.merged')}
        </p>
      )}
      {keptEdits && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
        >
          {t('form.archivedWhileEditing')}
        </p>
      )}
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-[18px] gap-y-3.5">
            {field('fullName')}
            {field('phone')}
            {field('dateOfBirth')}
            {field('sex')}
            {field('email')}
            {field('dentist')}
            {field('address', 'col-span-full')}
            {field('insurance')}
            {field('alerts', 'col-span-full')}
            {field('notes', 'col-span-full')}
          </div>
        </fieldset>
        {!readOnly && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-row-divider pt-4">
            {/* `aria-disabled`, not `disabled`: focus stays on the button through a save. */}
            <Button
              type="submit"
              variant="primary"
              aria-disabled={blocked}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            >
              {t('common:save')}
            </Button>
            <SaveState
              status={status}
              onRetry={() => {
                void submit();
              }}
            />
          </div>
        )}
      </form>
    </section>
  );
}
