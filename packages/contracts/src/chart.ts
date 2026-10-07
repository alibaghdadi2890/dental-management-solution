import {
  type DiagnosisRecord,
  type HistoryService,
  isOpenPlan,
  type ToothState,
  type ToothVisualState,
  type TreatmentPlan,
} from './clinical-records.js';
import type { SurfaceKey, ToothCode, ToothPresenceChange, ToothPresenceState } from './tooth.js';
import type { VisitService } from './visits.js';

/** Any non-'none' mark a tooth's overall `state` can carry. */
type ToothMark = Exclude<ToothVisualState, 'none'>;

/** The marks a completed or live *service* leaves on `surfaces`/`wholeTooth` — never 'planned'
 * or 'in_progress', which only ever show through `state` (see `cellMark`). */
type ServiceMark = Exclude<ToothMark, 'planned' | 'in_progress'>;

/** Precedence order (spec: "treated_today > in_progress > treated > planned > none"; work in
 * progress outranks older treatment, ADR-0032), used to resolve a single surface, the whole tooth,
 * or the tooth's overall state when touched by more than one source — e.g. a live service
 * overriding a historic one on the same surface. Higher wins; a mark never downgrades. */
const MARK_RANK: Record<ToothMark, number> = {
  treated_today: 4,
  in_progress: 3,
  treated: 2,
  planned: 1,
};

function strongerMark<T extends ToothMark>(current: T | undefined, candidate: T): T {
  if (current === undefined) return candidate;
  return MARK_RANK[candidate] > MARK_RANK[current] ? candidate : current;
}

/** Mutable per-tooth accumulator; converted to the public, immutable `ToothState` once every
 * record has been folded in. */
interface ToothBuilder {
  surfaces: Partial<Record<SurfaceKey, ServiceMark>>;
  /** Only ever a treated mark, and only from a whole-tooth *service* — a whole-tooth *plan* is
   * reflected via `openPlanIds` (and so `state`), never here. */
  wholeTooth: ServiceMark | null;
  hasActiveDiagnosis: boolean;
  openPlanIds: string[];
  /** An open plan on the tooth has been started. */
  inProgress: boolean;
  diagnosisNames: string[];
  planNames: string[];
  historyCount: number;
}

function newBuilder(): ToothBuilder {
  return {
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    openPlanIds: [],
    inProgress: false,
    diagnosisNames: [],
    planNames: [],
    historyCount: 0,
  };
}

function builderFor(builders: Map<ToothCode, ToothBuilder>, code: ToothCode): ToothBuilder {
  let builder = builders.get(code);
  if (!builder) {
    builder = newBuilder();
    builders.set(code, builder);
  }
  return builder;
}

/** Folds one completed or live service into its tooth: a service with no surfaces tints the
 * whole tooth, otherwise each named surface is marked individually — either way the mark only
 * strengthens what is already recorded (see `strongerMark`). */
function applyService(
  builder: ToothBuilder,
  surfaces: readonly SurfaceKey[],
  mark: ServiceMark,
): void {
  if (surfaces.length === 0) {
    builder.wholeTooth = strongerMark(builder.wholeTooth ?? undefined, mark);
    return;
  }
  for (const surface of surfaces) {
    builder.surfaces[surface] = strongerMark(builder.surfaces[surface], mark);
  }
}

/** The tooth's overall precedence state: the strongest mark across its whole-tooth mark, its
 * per-surface marks, and whether it carries any open plan at all (a whole-tooth open plan never
 * appears in `surfaces`/`wholeTooth`, only here). */
function overallState(builder: ToothBuilder): ToothVisualState {
  let strongest: ToothMark | undefined;
  if (builder.wholeTooth) strongest = strongerMark(strongest, builder.wholeTooth);
  for (const mark of Object.values(builder.surfaces)) {
    strongest = strongerMark(strongest, mark);
  }
  if (builder.openPlanIds.length > 0) {
    strongest = strongerMark(strongest, builder.inProgress ? 'in_progress' : 'planned');
  }
  return strongest ?? 'none';
}

/** The raw records `deriveChart` folds into per-tooth state. */
export interface DeriveChartInput {
  readonly diagnoses: readonly DiagnosisRecord[];
  readonly plans: readonly TreatmentPlan[];
  readonly history: readonly HistoryService[];
  readonly liveServices: readonly VisitService[];
  /** The patient's presence rows, in the order recorded (`PatientChart.presence`). */
  readonly presence: readonly ToothPresenceChange[];
}

/**
 * What is at each tooth that has a presence row (H1, D3): the row recorded last wins, whatever
 * its date. A tooth absent from the map is `present`.
 */
export function currentPresence(
  rows: readonly ToothPresenceChange[],
): Map<ToothCode, ToothPresenceState> {
  const current = new Map<ToothCode, ToothPresenceState>();
  for (const row of rows) current.set(row.toothCode, row.presence);
  return current;
}

/**
 * Derives per-tooth chart state (spec §Chart state / §Derived values) from a patient's raw
 * charting records. Pure — no I/O, no Nest — so the exact same function runs in the API's
 * `ChartService` and the SPA, which is what keeps the compact chart and the workspace chart
 * rendering from one source of truth.
 *
 * Callers pre-filter only soft-deleted rows; `deriveChart` itself is what drops a resolved
 * diagnosis, a performed/cancelled plan, or a jaw- or mouth-level record (`toothCode: null`) — none of
 * those contribute to any tooth.
 *
 * Returns one entry per tooth that has *something* recorded — an active diagnosis, an open plan,
 * a completed service or a live one, or a presence other than `present` (feature 7) — never all
 * 32/52 chart columns. A tooth absent from the map
 * carries no recorded treatment; callers (the compact chart, the workspace chart) render every
 * other column as the 'none' default without needing a lookup miss to mean anything else.
 */
export function deriveChart(input: DeriveChartInput): Map<ToothCode, ToothState> {
  const builders = new Map<ToothCode, ToothBuilder>();

  for (const record of input.diagnoses) {
    if (record.status !== 'active') continue;
    const builder = builderFor(builders, record.toothCode);
    builder.hasActiveDiagnosis = true;
    builder.diagnosisNames.push(record.name);
  }

  for (const record of input.plans) {
    if (!isOpenPlan(record)) continue;
    if (record.toothCode === null) continue;
    const builder = builderFor(builders, record.toothCode);
    builder.openPlanIds.push(record.id);
    if (record.status === 'in_progress') builder.inProgress = true;
    builder.planNames.push(record.name);
  }

  for (const record of input.history) {
    if (record.toothCode === null) continue;
    const builder = builderFor(builders, record.toothCode);
    builder.historyCount += 1;
    applyService(builder, record.surfaces, 'treated');
  }

  for (const record of input.liveServices) {
    if (record.toothCode === null) continue;
    const builder = builderFor(builders, record.toothCode);
    applyService(builder, record.surfaces, 'treated_today');
  }

  // A tooth that is not present has an entry even with nothing else recorded on it.
  const presence = currentPresence(input.presence);
  for (const [code, state] of presence) {
    if (state !== 'present') builderFor(builders, code);
  }

  const chart = new Map<ToothCode, ToothState>();
  for (const [code, builder] of builders) {
    chart.set(code, {
      code,
      presence: presence.get(code) ?? 'present',
      state: overallState(builder),
      surfaces: builder.surfaces,
      wholeTooth: builder.wholeTooth,
      hasActiveDiagnosis: builder.hasActiveDiagnosis,
      openPlanIds: builder.openPlanIds,
      historyCount: builder.historyCount,
      titleParts: {
        diagnoses: builder.diagnosisNames,
        plans: builder.planNames,
        historyCount: builder.historyCount,
      },
    });
  }
  return chart;
}

/**
 * The precedence-resolved mark for one tooth's surface — the stronger of that surface's own
 * service mark and the tooth's whole-tooth service mark, else 'planned' or 'in_progress' when that
 * is the tooth's overall `state` (an open plan washes every surface that carries no service mark of
 * its own, mirroring the POC's `toothCells`), else 'none'. `tooth` is `undefined` for a tooth absent from
 * `deriveChart`'s map, which is always 'none'. Callers (the surface-mode glyph) use this instead
 * of re-deriving the precedence themselves.
 */
export function cellMark(tooth: ToothState | undefined, surface: SurfaceKey): ToothVisualState {
  if (!tooth) return 'none';
  let mark: ServiceMark | undefined = tooth.surfaces[surface];
  if (tooth.wholeTooth) mark = strongerMark(mark, tooth.wholeTooth);
  if (mark) return mark;
  return tooth.state === 'planned' || tooth.state === 'in_progress' ? tooth.state : 'none';
}
