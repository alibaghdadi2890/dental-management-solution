import type {
  ChargeUnit,
  DiagnosisItem,
  Jaw,
  PlanGroupInput,
  ServiceItem,
  SurfaceKey,
  ToothCode,
  ToothPresenceChange,
  TreatmentPlan,
  UpdateServiceInput,
  Visit,
  VisitService,
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
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import type { PresenceDetails } from '../presence/presence-dialog';
import { useDropSaveGroup, useFlushSaveGroups } from '../save-groups-context';
import { useVisitMutations } from '../visit-mutations';
import type { ToothSelection } from './tooth-selection';
import { apiErrorMessage } from '@/lib/api-error-message';

/** The catalog drawer's three modes (spec §Add Service / Plan Treatment / Diagnosis Drawer). */
export type DrawerMode = 'service' | 'plan' | 'diagnosis';

/** What a drawer row commits against: the tooth and pending surfaces at the moment of the click,
 * and for a per-jaw row the jaw its button named. */
export interface ChartTarget {
  tooth: ToothCode | null;
  surfaces: readonly SurfaceKey[];
  jaw?: Jaw | undefined;
}

/** What every service price group's key starts with. */
export const SERVICE_PRICE_PREFIX = 'service:';

/** The save group key of one service's Base/Discount inputs (V6), shared by every place that
 * edits that price (the tooth panel, the summary dialog). */
export const servicePriceKey = (serviceId: string) => `${SERVICE_PRICE_PREFIX}${serviceId}`;

/** Where the charting happens: inside a live visit, or on the patient record without one
 * (ADR-0031), where only diagnoses and plans are recorded. */
export type ChartingScope = { kind: 'visit'; visitId: string } | { kind: 'patient' };

/** Whether a diagnosis or plan was recorded where the charting happens: in this visit, or on the
 * patient record. Such a record is removed; another is resolved or cancelled (W13, ADR-0031). */
export const madeHere = (scope: ChartingScope, record: { recordedInVisitId: string | null }) =>
  scope.kind === 'visit'
    ? record.recordedInVisitId === scope.visitId
    : record.recordedInVisitId === null;

/** Managing the patient's named plans: the patient record's Chart tab only. */
export interface PlanGroupActions {
  create: (input: PlanGroupInput) => Promise<void>;
  update: (groupId: string, input: PlanGroupInput) => Promise<void>;
  remove: (groupId: string) => void;
  /** Moves an open plan into a named plan, or out of any (`null`). */
  movePlan: (planId: string, groupId: string | null) => void;
}

export interface ChartingActions {
  /** In the patient scope the visit-only actions (services, perform, resolve) are
   * never offered. */
  scope: ChartingScope;
  addService: (item: ServiceItem, target: ChartTarget) => void;
  planTreatment: (item: ServiceItem, target: ChartTarget) => void;
  recordDiagnosis: (item: DiagnosisItem, target: ChartTarget) => void;
  /** Perform now, or Complete for an unfinished service: the plan becomes a service of this
   * visit, with an Undo toast. */
  performPlan: (plan: TreatmentPlan) => void;
  /** Not finished (ADR-0032): the service leaves the visit's charges and carries on to the
   * visit that completes it. */
  markUnfinished: (service: VisitService) => void;
  /** Continue: this visit works on an unfinished service. */
  continuePlan: (plan: TreatmentPlan) => void;
  /** Not today: undoes this visit's work on an unfinished service from an earlier visit. */
  undoSession: (plan: TreatmentPlan) => void;
  /** Removes an unfinished service first added in this visit. */
  removeUnfinished: (plan: TreatmentPlan) => void;
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
  /**
   * Sets what is at one or several tooth positions (feature 7, H1). In a visit it applies at
   * once, dated by the visit, and `details` is not used. On the patient record `details` says
   * when, why and for which dentist. Either way a toast offers Undo. Rejects when the save
   * failed (the failure has been shown).
   */
  setPresence: (teeth: readonly ToothPresenceChange[], details?: PresenceDetails) => Promise<void>;
}

/** Runs one of `visitMutations`' options outside a component's lifecycle: the drawer closes on
 * the click that commits, and an Undo toast outlives the panel that raised it. */
function runner(queryClient: QueryClient) {
  return <TData, TVariables, TContext>(
    options: MutationOptions<TData, Error, TVariables, TContext>,
    variables: TVariables,
  ): Promise<TData> => new MutationObserver(queryClient, options).mutate(variables);
}

/** A per-tooth catalog item takes the tooth and its pending surfaces, a per-jaw one its jaw, a
 * whole-mouth one nothing. */
export function scopeOf(chargeUnit: ChargeUnit, target: ChartTarget) {
  if (chargeUnit === 'per_jaw') return { surfaces: [], ...(target.jaw && { jaw: target.jaw }) };
  if (chargeUnit === 'per_mouth' || target.tooth === null) return { surfaces: [] };
  return { toothCode: target.tooth, surfaces: [...target.surfaces] };
}

/**
 * The workspace's charting writes (spec §Diagnosis → Treatment Plan → Completed Treatment), with
 * the POC's toasts: service added (+ Undo), diagnosis recorded (+ Plan treatment, reopening the
 * drawer in plan mode on the same tooth), treatment planned, plan performed (+ Undo). None asks for confirmation (§Confirmation & Destructive Actions). Every
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
  const flush = useFlushSaveGroups();
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  // The same set, read synchronously: a second Remove (the card's, then a toast's Undo) of a
  // service whose DELETE is in flight is skipped.
  const removingRef = useRef(new Set<string>());
  const { ensureSelected } = selection;

  return useMemo(() => {
    const run = runner(queryClient);
    const failed = (error: unknown) => {
      const reason = apiErrorMessage(error, i18n);
      toast(t('actions.failed', { reason }), { tone: 'danger' });
    };
    const fire = <TData, TVariables, TContext>(
      options: MutationOptions<TData, Error, TVariables, TContext>,
      variables: TVariables,
    ) => {
      run(options, variables).catch(failed);
    };
    const tooth = (code: ToothCode) => t('actions.tooth', { label: toothLabel(code) });
    const targetOf = (record: { toothCode: ToothCode | null; jaw: Jaw | null }) =>
      record.toothCode === null ? levelLabel(record.jaw) : tooth(record.toothCode);
    /** "Tooth #46 · tooth marked missing": what a service did to its tooth, said with it. */
    const withPresence = (body: string, change: ToothPresenceChange | null | undefined) =>
      change ? `${body} · ${t(`presence.suffix.${change.presence}`)}` : body;

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
      scope: { kind: 'visit', visitId: visit.id },
      removing,
      removeService,
      addService: (item, target) => {
        run(mutations.addService, { procedureId: item.id, ...scopeOf(item.chargeUnit, target) })
          .then(({ record, presenceChange }) => {
            toast(t('actions.serviceAdded', { name: item.name }), {
              // Undo removes the service, and with it what it did to the tooth (H2).
              body: withPresence(targetOf(record), presenceChange),
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
                target: targetOf(record),
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
      markUnfinished: (service) => {
        // The plan takes the service's price, so an edit still on its way is saved first.
        flush()
          .then((saved) => {
            if (!saved) throw new Error(t('actions.unsavedPrice'));
            drop(servicePriceKey(service.id));
            return run(mutations.markUnfinished, service.id);
          })
          .then(({ record }) => {
            toast(t('actions.unfinished', { name: service.name }), {
              body: targetOf(record),
              actionLabel: t('actions.undo'),
              onAction: () => {
                fire(mutations.performPlan, record.id);
              },
            });
          })
          .catch(failed);
      },
      removeUnfinished: (plan) => {
        run(mutations.removeSession, plan.id)
          // Work first added in this visit leaves no plan behind; a plan from before stays planned.
          .then(({ record }) =>
            record.recordedInVisitId === visit.id && record.status === 'planned'
              ? run(mutations.removePlan, plan.id)
              : undefined,
          )
          .catch(failed);
      },
      continuePlan: (plan) => {
        run(mutations.recordSession, plan.id)
          .then(() => {
            toast(t('actions.continued', { name: plan.name }), {
              actionLabel: t('actions.undo'),
              onAction: () => {
                fire(mutations.removeSession, plan.id);
              },
            });
          })
          .catch(failed);
      },
      undoSession: (plan) => {
        fire(mutations.removeSession, plan.id);
      },
      performPlan: (plan) => {
        run(mutations.performPlan, plan.id)
          .then(({ visit: updated, presenceChange }) => {
            const service = updated.services.find((line) => line.planId === plan.id);
            toast(t('actions.performed', { name: plan.name }), {
              body: withPresence(
                t('actions.performedBody', { price: formatMoney(plan.price, locale) }),
                presenceChange,
              ),
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
      setPresence: async (teeth) => {
        for (const change of teeth) {
          try {
            const { record } = await run(mutations.setPresence, change);
            const label = toothLabel(change.toothCode).replace(/^#/, '');
            if (record === null) {
              toast(t('presence.unchanged'));
              continue;
            }
            toast(t(`presence.marked.${change.presence}`, { label }), {
              actionLabel: t('actions.undo'),
              onAction: () => {
                fire(mutations.removePresence, record.id);
              },
            });
          } catch (error) {
            failed(error);
            throw error;
          }
        }
      },
    } satisfies ChartingActions;
  }, [
    visit.id,
    queryClient,
    mutations,
    drop,
    flush,
    toast,
    t,
    i18n,
    locale,
    toothLabel,
    levelLabel,
    removing,
    ensureSelected,
    openDrawer,
  ]);
}

export const ChartingActionsContext = createContext<ChartingActions | null>(null);

export function useChartingActions(): ChartingActions {
  const actions = useContext(ChartingActionsContext);
  if (!actions) {
    throw new Error('useChartingActions must be used inside a charting provider');
  }
  return actions;
}
