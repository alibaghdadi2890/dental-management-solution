import type { Jaw, ToothCode } from '@dcm/contracts';
import { MutationObserver, type MutationOptions, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import {
  type ChartingActions,
  type DrawerMode,
  type PlanGroupActions,
  scopeOf,
} from '../workspace/charting-actions';
import type { ToothSelection } from '../workspace/tooth-selection';
import { usePatientRecordMutations } from './patient-records-api';

/** What only a visit does: never offered in the patient scope, so never called. */
const visitOnly = () => undefined;

/**
 * The patient record's charting writes (ADR-0031): the same `ChartingActions` the visit workspace
 * provides, bound to the patient instead of a visit. A diagnosis and a plan are recorded with no
 * visit, for `dentistId` (left out when the caller is the dentist); a record made here is removed,
 * a plan made in a visit cancelled. Performing, resolving, services and tooth presence need a
 * visit: `scope.kind` is `patient`, so the shared components leave those controls out.
 */
export function usePatientChartingActions({
  patientId,
  dentistId,
  selection,
  openDrawer,
}: {
  patientId: string;
  /** The dentist the records are for, when the caller isn't one. */
  dentistId: string | undefined;
  selection: ToothSelection;
  openDrawer: (mode: DrawerMode) => void;
}): ChartingActions & { groups: PlanGroupActions } {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutations = usePatientRecordMutations(patientId);
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const { ensureSelected } = selection;

  return useMemo(() => {
    const run = <TData, TVariables, TContext>(
      options: MutationOptions<TData, Error, TVariables, TContext>,
      variables: TVariables,
    ): Promise<TData> => new MutationObserver(queryClient, options).mutate(variables);
    const failed = (error: unknown) => {
      toast(t('actions.failed', { reason: apiErrorMessage(error, i18n) }), { tone: 'danger' });
    };
    const fire = <TData, TVariables, TContext>(
      options: MutationOptions<TData, Error, TVariables, TContext>,
      variables: TVariables,
    ) => {
      run(options, variables).catch(failed);
    };
    const tooth = (code: ToothCode) => t('actions.tooth', { label: toothLabel(code) });
    const targetOf = (target: { toothCode?: ToothCode | undefined; jaw?: Jaw | undefined }) =>
      target.toothCode === undefined ? levelLabel(target.jaw) : tooth(target.toothCode);
    const forDentist = dentistId === undefined ? {} : { dentistId };

    return {
      scope: { kind: 'patient' },
      removing: new Set<string>(),
      addService: visitOnly,
      performPlan: visitOnly,
      markUnfinished: visitOnly,
      continuePlan: visitOnly,
      undoSession: visitOnly,
      removeUnfinished: visitOnly,
      removeService: visitOnly,
      saveServicePrice: () => Promise.resolve(),
      resolveDiagnosis: visitOnly,
      reopenDiagnosis: visitOnly,
      planTreatment: (item, target) => {
        const scope = scopeOf(item.chargeUnit, target);
        run(mutations.planTreatment, {
          procedureId: item.id,
          ...scope,
          note: null,
          ...forDentist,
        })
          .then(() => {
            toast(t('actions.planned', { name: item.name }), {
              body: t('actions.plannedBody', {
                target: targetOf(scope),
                price: formatMoney(item.price, locale),
              }),
            });
          })
          .catch(failed);
      },
      recordDiagnosis: (item, target) => {
        const code = target.tooth;
        if (code === null) return;
        run(mutations.recordDiagnosis, {
          diagnosisId: item.id,
          toothCode: code,
          surfaces: [...target.surfaces],
          note: null,
          ...forDentist,
        })
          .then(() => {
            toast(t('actions.diagnosed', { name: item.name }), {
              body: t('actions.diagnosedBody', { tooth: tooth(code) }),
              actionLabel: t('actions.planTreatment'),
              onAction: () => {
                ensureSelected(code);
                openDrawer('plan');
              },
            });
          })
          .catch(failed);
      },
      removeDiagnosis: (recordId) => {
        fire(mutations.removeDiagnosis, recordId);
      },
      removePlan: (planId) => {
        fire(mutations.removePlan, planId);
      },
      cancelPlan: (planId) => {
        fire(mutations.cancelPlan, planId);
      },
      groups: {
        create: (input) => run(mutations.createGroup, input).then(visitOnly),
        update: (groupId, input) => run(mutations.updateGroup, { groupId, input }).then(visitOnly),
        remove: (groupId) => {
          fire(mutations.deleteGroup, groupId);
        },
        movePlan: (planId, groupId) => {
          fire(mutations.updatePlan, { planId, patch: { groupId } });
        },
      },
    } satisfies ChartingActions & { groups: PlanGroupActions };
  }, [
    queryClient,
    mutations,
    toast,
    t,
    i18n,
    locale,
    toothLabel,
    levelLabel,
    dentistId,
    ensureSelected,
    openDrawer,
  ]);
}
