import { DENTITION_STAGES, type DentitionStage, type Patient } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { patientKeys, setDentition } from '@/features/patients/patients-api';
import { useActingTenantId } from '@/features/platform/acting-tenant';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import { clinicalKeys } from '../visits-api';

/**
 * The chart card's small toggle between a patient's two charts, **Primary** and **Permanent**,
 * beside the card's title. Every patient has both; the one their age opens on (primary up to 12) is the default.
 * Switching shows the other chart at once (`onChange`) and, with `visit:write`, is remembered on
 * the patient (`PUT /patients/:id/dentition`), so the same chart opens next time for everyone.
 * Without it the switch is only the viewer's own.
 */
export function DentitionSelect({
  patient,
  stage,
  canWrite,
  onChange,
}: {
  patient: Patient;
  /** The chart on screen. */
  stage: DentitionStage;
  canWrite: boolean;
  onChange: (stage: DentitionStage) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const toast = useToast();
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  const remember = useMutation({
    mutationFn: (override: DentitionStage) => setDentition(patient.id, { override }),
    onSuccess: (updated) => {
      queryClient.setQueryData(patientKeys.detail(tenantId, updated.id), updated);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: clinicalKeys.chart(tenantId, updated.id) }),
        queryClient.invalidateQueries({ queryKey: patientKeys.audit(tenantId, updated.id) }),
      ]);
    },
    onError: (error) => {
      toast(t('dentition.failed', { reason: apiErrorMessage(error, i18n) }), { tone: 'danger' });
    },
  });

  return (
    <div
      role="group"
      aria-label={t('dentition.label')}
      className="inline-flex gap-0.5 rounded-[7px] border border-border bg-subtle p-0.5"
    >
      {DENTITION_STAGES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === stage}
          onClick={() => {
            if (option === stage) return;
            onChange(option);
            if (canWrite) remember.mutate(option);
          }}
          className={cn(
            'h-[22px] cursor-pointer rounded-[5px] border-0 px-2 text-[12px] leading-none font-medium',
            option === stage
              ? 'bg-surface font-semibold text-primary shadow-[0_1px_2px_rgba(27,26,31,.08)]'
              : 'bg-transparent text-ink-secondary hover:text-ink',
          )}
        >
          {t(`dentition.stage.${option}`)}
        </button>
      ))}
    </div>
  );
}
