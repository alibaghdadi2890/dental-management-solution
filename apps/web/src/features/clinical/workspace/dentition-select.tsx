import { DENTITION_STAGES, type DentitionStage, type Patient } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast-context';
import { patientKeys, setDentition } from '@/features/patients/patients-api';
import { useActingTenantId } from '@/features/platform/acting-tenant';
import { clinicalKeys } from '../visits-api';
import { apiErrorMessage } from '@/lib/api-error-message';

export interface ResolvedDentition {
  stage: DentitionStage;
  source: 'auto' | 'override';
  ageYears: number | null;
}

const AUTO = 'auto';

/**
 * The chart card's **Dentition** selector (spec W14): "Auto · Mixed (age 8)" while the stage
 * follows the patient's age, else the stage set by hand; Primary, Mixed or Permanent override it,
 * and Back to auto clears the override (`PUT /patients/:id/dentition`, `visit:write`). The chart
 * is refetched for the new stage, and a toast confirms. Without `visit:write` it is plain text.
 */
export function DentitionSelect({
  patient,
  dentition,
  canWrite,
}: {
  patient: Patient;
  dentition: ResolvedDentition;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const toast = useToast();
  const queryClient = useQueryClient();
  const tenantId = useActingTenantId();
  const change = useMutation({
    mutationFn: (override: DentitionStage | null) => setDentition(patient.id, { override }),
    onSuccess: (updated) => {
      queryClient.setQueryData(patientKeys.detail(tenantId, updated.id), updated);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: clinicalKeys.chart(tenantId, updated.id) }),
        queryClient.invalidateQueries({ queryKey: patientKeys.audit(tenantId, updated.id) }),
      ]);
    },
  });

  const stageName = (stage: DentitionStage) => t(`dentition.stage.${stage}`);
  const value =
    dentition.source === 'override'
      ? t('dentition.manual', { stage: stageName(dentition.stage) })
      : dentition.ageYears === null
        ? t('dentition.auto', { stage: stageName(dentition.stage) })
        : t('dentition.autoAge', { stage: stageName(dentition.stage), age: dentition.ageYears });
  const label = t('dentition.label', { value });

  if (!canWrite) {
    return <span className="text-[12.5px] leading-none text-ink-secondary">{label}</span>;
  }

  const current = patient.dentitionOverride ?? AUTO;
  const choose = (next: string) => {
    if (next === current || change.isPending) return;
    const override = DENTITION_STAGES.find((stage) => stage === next) ?? null;
    change.mutate(override, {
      onSuccess: () => {
        toast(
          override === null
            ? t('dentition.backToAutoDone')
            : t('dentition.setDone', { stage: stageName(override) }),
          { tone: 'success' },
        );
      },
      onError: (error) => {
        toast(t('dentition.failed', { reason: apiErrorMessage(error, i18n) }), { tone: 'danger' });
      },
    });
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-control bg-surface px-2.5 text-[12.5px] leading-none font-medium text-ink-secondary hover:border-primary hover:text-primary"
        >
          {label}
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M3.5 6 8 10.5 12.5 6" />
          </svg>
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuRadioGroup value={current} onValueChange={choose}>
          {DENTITION_STAGES.map((stage) => (
            <MenuRadioItem key={stage} value={stage}>
              {stageName(stage)}
            </MenuRadioItem>
          ))}
          {patient.dentitionOverride !== null && (
            <>
              <MenuSeparator />
              <MenuRadioItem value={AUTO}>{t('dentition.backToAuto')}</MenuRadioItem>
            </>
          )}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
