import type {
  DiagnosisRecord,
  HistoryService,
  ToothState,
  ToothVisualState,
  TreatmentPlan,
} from './clinical-records.js';
import type { SurfaceKey, ToothCode } from './tooth.js';
import type { VisitService } from './visits.js';

/**
 * Derives per-tooth chart state (feature 4a, Task A3; spec §Chart state / §Derived values) from
 * a patient's raw charting records. Pure — no I/O, no Nest — so the exact same function runs in
 * the API's `ChartService` and the SPA, which is what keeps the compact chart and the workspace
 * chart rendering from one source of truth.
 *
 * Inputs are already-filtered, non-deleted rows (repositories exclude soft-deleted records
 * before calling this): a resolved diagnosis, a performed/cancelled plan, or a jaw-level record
 * (`toothCode: null`) simply does not contribute to any tooth.
 */

/** The non-'none' half of `ToothVisualState` — what a single record can mark a tooth or surface
 * with, before `deriveChart` reduces many records down to one state per tooth. */
type ToothMark = Exclude<ToothVisualState, 'none'>;

/** A completed or live *service*'s mark never includes 'planned' — only a plan record does. */
type ServiceMark = Exclude<ToothMark, 'planned'>;

/** Precedence order (spec: "treated_today > treated > planned > none"), also used to resolve a
 * single surface (or the whole tooth) touched by more than one source — e.g. a live service
 * overriding a historic one on the same surface. Higher wins; a mark never downgrades. */
const MARK_RANK: Record<ToothMark, number> = { treated_today: 3, treated: 2, planned: 1 };

function strongerMark<T extends ToothMark>(current: T | undefined, candidate: T): T {
  if (current === undefined) return candidate;
  return MARK_RANK[candidate] > MARK_RANK[current] ? candidate : current;
}

/** Mutable per-tooth accumulator; converted to the public, immutable `ToothState` once every
 * record has been folded in. */
interface ToothBuilder {
  surfaces: Partial<Record<SurfaceKey, ToothMark>>;
  /** Only ever a treated mark (spec/clinical-records.ts: a whole-tooth *plan* is reflected via
   * `state`/`openPlanIds`, never here — `wholeTooth` is exclusively what a whole-tooth *service*,
   * historic or live, leaves). */
  wholeTooth: ServiceMark | null;
  hasActiveDiagnosis: boolean;
  openPlanIds: string[];
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
  let rank = 0;
  if (builder.wholeTooth) rank = Math.max(rank, MARK_RANK[builder.wholeTooth]);
  for (const mark of Object.values(builder.surfaces)) {
    rank = Math.max(rank, MARK_RANK[mark]);
  }
  if (builder.openPlanIds.length > 0) rank = Math.max(rank, MARK_RANK.planned);

  if (rank === MARK_RANK.treated_today) return 'treated_today';
  if (rank === MARK_RANK.treated) return 'treated';
  if (rank === MARK_RANK.planned) return 'planned';
  return 'none';
}

export interface DeriveChartInput {
  diagnoses: DiagnosisRecord[];
  plans: TreatmentPlan[];
  history: HistoryService[];
  liveServices: VisitService[];
}

/**
 * One entry per tooth that has *something* recorded — an active diagnosis, an open plan, a
 * completed service or a live one — never all 32/52 chart columns. A tooth absent from the map
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
    if (record.status !== 'planned') continue;
    if (record.toothCode === null) continue;
    const builder = builderFor(builders, record.toothCode);
    builder.openPlanIds.push(record.id);
    builder.planNames.push(record.name);
    for (const surface of record.surfaces) {
      builder.surfaces[surface] = strongerMark(builder.surfaces[surface], 'planned');
    }
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

  const chart = new Map<ToothCode, ToothState>();
  for (const [code, builder] of builders) {
    chart.set(code, {
      code,
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
