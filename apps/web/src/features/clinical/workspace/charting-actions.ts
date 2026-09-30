import type {
  ChargeUnit,
  DiagnosisItem,
  PermanentToothCode,
  ServiceItem,
  SurfaceKey,
  ToothCode,
  ToothPresenceValue,
  TreatmentPlan,
  UpdateServiceInput,
  Visit,
} from '@dcm/contracts';
import {
  MutationObserver,
  type MutationOptions,
  type QueryClient,
  useQueryClient,
} from '@tanstack/react-query';
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useToothLabel } from '../chart/use-chart-settings';
import { useDropSaveGroup } from '../save-groups-context';
import { useVisitMutations } from '../visit-mutations';
import type { ToothSelection } from './tooth-selection';

/** The catalog drawer's three modes (spec §Add Service / Plan Treatment / Diagnosis Drawer). */
export type DrawerMode = 'service' | 'plan' | 'diagnosis';

/** What a drawer row commits against: the tooth and pending surfaces at the moment of the click. */
export interface ChartTarget {
  tooth: ToothCode | null;
  surfaces: readonly SurfaceKey[];
}

/** What every service price group's key starts with. */
export const SERVICE_PRICE_PREFIX = 'service:';

/** The save group key of one service's Base/Discount inputs (V6), shared by every place that
 * edits that price (the tooth panel, the summary dialog). */
export const servicePriceKey = (serviceId: string) => `${SERVICE_PRICE_PREFIX}${serviceId}`;

export interface ChartingActions {
  addService: (item: ServiceItem, target: ChartTarget) => void;
  planTreatment: (item: ServiceItem, target: ChartTarget) => void;
  recordDiagnosis: (item: DiagnosisItem, target: ChartTarget) => void;
  /** Perform now: the plan becomes a service of this visit, with an Undo toast. */
  performPlan: (plan: TreatmentPlan) => void;
  removeService: (serviceId: string) => void;
  /** The services whose DELETE is in flight: their price inputs are frozen. */
  removing: ReadonlySet<string>;
  /** One service's price save (its save group's `save`). */
  saveServicePrice: (serviceId: string, patch: UpdateServiceInput) => Promise<unknown>;
  resolveDiagnosis: (recordId: string) => void;
  reopenDiagnosis: (recordId: string) => void;
  removeDiagnosis: (recordId: string) => void;
  removePlan: (planId: string) => void;
  cancelPlan: (planId: string) => void;
  /** The succession row (W5): records what occupies a column, then selects that tooth. */
  setToothPresence: (
    position: PermanentToothCode,
    present: ToothPresenceValue,
    select: ToothCode,
  ) => void;
}

/** Runs one of `visitMutations`' options outside a component's lifecycle: the drawer closes on
 * the click that commits, and an Undo toast outlives the panel that raised it. */
function runner(queryClient: QueryClient) {
  return <TData, TVariables, TContext>(
    options: MutationOptions<TData, Error, TVariables, TContext>,
    variables: TVariables,
  ): Promise<TData> => new MutationObserver(queryClient, options).mutate(variables);
}

/** A per-tooth catalog item takes the tooth and its pending surfaces; a per-jaw one neither. */
function scopeOf(chargeUnit: ChargeUnit, target: ChartTarget) {
  if (chargeUnit === 'per_jaw' || target.tooth === null) return { surfaces: [] };
  return { toothCode: target.tooth, surfaces: [...target.surfaces] };
}

/**
 * The workspace's charting writes (spec §Diagnosis → Treatment Plan → Completed Treatment), with
 * the POC's toasts: service added (+ Undo), diagnosis recorded (+ Plan treatment, reopening the
 * drawer in plan mode on the same tooth), treatment planned, plan performed (+ Undo), tooth
 * presence changed. None asks for confirmation (§Confirmation & Destructive Actions). Every
 * service DELETE first drops the service's price group, so an unsaved price edit never reaches
 * the deleted row nor keeps the workspace dirty. Created once per workspace and shared through
 * `ChartingActionsContext`.
 */
export function useChartingActionsState({
  visit,
  selection,
  openDrawer,
}: {
  visit: Visit;
  selection: ToothSelection;
  openDrawer: (mode: DrawerMode) => void;
}): ChartingActions {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutations = useVisitMutations(visit.id);
  const drop = useDropSaveGroup();
  const toothLabel = useToothLabel();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  // The same set, read synchronously: a second Remove (the card's, then a toast's Undo) of a
  // service whose DELETE is in flight is skipped.
  const removingRef = useRef(new Set<string>());
  const { select, ensureSelected } = selection;

  return useMemo(() => {
    const run = runner(queryClient);
    const failed = (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      toast(t('actions.failed', { reason }), { tone: 'danger' });
    };
    const fire = <TData, TVariables, TContext>(
      options: MutationOptions<TData, Error, TVariables, TContext>,
      variables: TVariables,
    ) => {
      run(options, variables).catch(failed);
    };
    const tooth = (code: ToothCode | null) =>
      code === null ? t('actions.jawLevel') : t('actions.tooth', { label: toothLabel(code) });

    const removeService = (serviceId: string) => {
      if (removingRef.current.has(serviceId)) return;
      removingRef.current.add(serviceId);
      drop(servicePriceKey(serviceId));
      setRemoving((current) => new Set(current).add(serviceId));
      run(mutations.removeService, serviceId)
        .catch((error: unknown) => {
          // Already gone (removed here a moment ago, or by someone else): the goal is met.
          if (!(error instanceof ApiError && error.status === 404)) failed(error);
        })
        .finally(() => {
          removingRef.current.delete(serviceId);
          setRemoving((current) => {
            const next = new Set(current);
            next.delete(serviceId);
            return next;
          });
        });
    };

    return {
      removing,
      removeService,
      addService: (item, target) => {
        run(mutations.addService, { procedureId: item.id, ...scopeOf(item.chargeUnit, target) })
          .then(({ record }) => {
            toast(t('actions.serviceAdded', { name: item.name }), {
              body:
                record.toothCode === null ? t('actions.jawLevelService') : tooth(record.toothCode),
              actionLabel: t('actions.undo'),
              onAction: () => {
                removeService(record.id);
              },
            });
          })
          .catch(failed);
      },
      planTreatment: (item, target) => {
        const scope = scopeOf(item.chargeUnit, target);
        run(mutations.planTreatment, { procedureId: item.id, ...scope, note: null })
          .then(({ record }) => {
            toast(t('actions.planned', { name: item.name }), {
              body: t('actions.plannedBody', {
                target: tooth(record.toothCode),
                price: formatMoney(record.price, locale),
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
      performPlan: (plan) => {
        run(mutations.performPlan, plan.id)
          .then(({ visit: updated }) => {
            const service = updated.services.find((line) => line.planId === plan.id);
            toast(t('actions.performed', { name: plan.name }), {
              body: t('actions.performedBody', { price: formatMoney(plan.price, locale) }),
              ...(service && {
                actionLabel: t('actions.undo'),
                onAction: () => {
                  removeService(service.id);
                },
              }),
            });
          })
          .catch(failed);
      },
      saveServicePrice: (serviceId, patch) => run(mutations.updateService, { serviceId, patch }),
      resolveDiagnosis: (recordId) => {
        fire(mutations.resolveDiagnosis, recordId);
      },
      reopenDiagnosis: (recordId) => {
        fire(mutations.reopenDiagnosis, recordId);
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
      setToothPresence: (position, present, next) => {
        run(mutations.setToothPresence, { position, present })
          .then(() => {
            select(next);
            const done = present === 'permanent' ? 'exfoliated' : 'retained';
            toast(t(`succession.${done}`), { body: t(`succession.${done}Body`) });
          })
          .catch(failed);
      },
    } satisfies ChartingActions;
  }, [
    queryClient,
    mutations,
    drop,
    toast,
    t,
    locale,
    toothLabel,
    removing,
    select,
    ensureSelected,
    openDrawer,
  ]);
}

export const ChartingActionsContext = createContext<ChartingActions | null>(null);

export function useChartingActions(): ChartingActions {
  const actions = useContext(ChartingActionsContext);
  if (!actions) {
    throw new Error('useChartingActions must be used inside the visit workspace');
  }
  return actions;
}
