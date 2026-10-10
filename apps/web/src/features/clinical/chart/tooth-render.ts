import {
  type ChartMode,
  isPrimary,
  type MarkColor,
  type MarkIcon,
  surfaceCells,
  type SurfaceKey,
  type ToothCode,
  type ToothPresenceState,
  type ToothState,
} from '@dcm/contracts';
import type { TFunction } from 'i18next';

/** What the chart shows on the teeth: what is wrong, what was done, or both (feature 9). */
export const CHART_VIEWS = ['diagnoses', 'services', 'both'] as const;
export type ChartView = (typeof CHART_VIEWS)[number];

/** The legend item whose teeth stand out (M11): a catalog diagnosis or service. */
export interface ChartHighlight {
  kind: 'diagnosis' | 'service';
  /** The catalog item's id. */
  id: string;
}

/**
 * One painted area. `color` is the catalog colour of the item that painted it (`none` when the
 * item has none), or `planned` for the wash of an open plan. `tone` is the status cue (M2):
 * done or found now, done before, or the wash.
 */
export interface Fill {
  color: MarkColor | 'planned' | 'none';
  tone: 'today' | 'past' | 'wash';
  /** The item that painted it, for a surface's accessible name; null for the wash. */
  label: string | null;
  /** It is the legend's highlighted item. */
  ringed: boolean;
}

export interface BandItem {
  kind: 'diagnosis' | 'service';
  /** The catalog item's id, and the record's own code. */
  id: string;
  code: string;
  color: MarkColor | null;
  icon: MarkIcon | null;
  tone: 'today' | 'past';
  label: string;
  ringed: boolean;
}

export interface Dot {
  color: MarkColor | null;
  label: string;
  ringed: boolean;
}

/**
 * Everything a glyph draws for one tooth, and nothing it has to work out (feature 9): the chart,
 * history and panel glyphs render this object, as will the anatomical chart later. Built by
 * `toToothRender` only, so the picture and the tooltip cannot disagree.
 */
export interface ToothRender {
  presence: ToothPresenceState;
  /** At most one is drawn: selected, else in progress, else planned. */
  rings: { selected: boolean; planned: boolean; inProgress: boolean };
  /** Another item is highlighted and this tooth does not carry it. */
  faded: boolean;
  /** The 8 px chart: the band is dots, and there are no diagnosis dots (M9). */
  compact: boolean;
  /** Simple mode: the whole-tooth fill. Null in surface mode and for an absent tooth. */
  body: Fill | null;
  /** Surface mode: the surfaces that carry a fill; the others are plain. */
  cells: Partial<Record<SurfaceKey, Fill>>;
  /** Up to three chips at the root end, and how many more there are. */
  band: BandItem[];
  bandOverflow: number;
  /** Both view: the diagnoses beside the number, up to three, and how many more. */
  dots: Dot[];
  dotOverflow: number;
  /** The hover title and accessible name. */
  title: string;
}

/** The words a title is made of: the caller's translator and formatters, so this file stays pure. */
export interface ChartText {
  t: TFunction<'clinical'>;
  /** `#16`, in the clinic's notation. */
  label: (code: ToothCode) => string;
  /** `Upper right first molar`. */
  name: (code: ToothCode) => string;
  /** A local date (`2026-03-12`) as the app shows dates. */
  date: (iso: string) => string;
  /** `O · D`. */
  surfaces: (surfaces: readonly SurfaceKey[]) => string;
}

export interface ToothRenderOptions {
  code: ToothCode;
  view: ChartView;
  mode: ChartMode;
  /** What is at the position, as the chart resolved it (a tooth not erupted yet included). */
  presence: ToothPresenceState;
  selected?: boolean;
  compact?: boolean;
  highlight?: ChartHighlight | null;
  text: ChartText;
}

const MAX_BAND = 3;
const MAX_DOTS = 3;
const SEPARATOR = ' · ';

/** A diagnosis or service of the tooth, ready to paint. */
interface Mark {
  kind: 'diagnosis' | 'service';
  id: string;
  code: string;
  label: string;
  color: MarkColor | null;
  icon: MarkIcon | null;
  tone: 'today' | 'past';
  /** Empty = the whole tooth. */
  surfaces: readonly SurfaceKey[];
}

/** An active diagnosis is a present fact, so it is drawn at full strength. */
function diagnosisMarks(tooth: ToothState | undefined): Mark[] {
  return (tooth?.diagnoses ?? []).map((item) => ({
    kind: 'diagnosis',
    id: item.diagnosisId,
    code: item.code,
    label: item.name,
    color: item.color,
    icon: null,
    tone: 'today',
    surfaces: item.surfaces,
  }));
}

function serviceMarks(tooth: ToothState | undefined): Mark[] {
  return (tooth?.services ?? []).map((item) => ({
    kind: 'service',
    id: item.procedureId,
    code: item.code,
    label: item.name,
    color: item.color,
    icon: item.icon,
    tone: item.status === 'treated_today' ? 'today' : 'past',
    surfaces: item.surfaces,
  }));
}

/** The five surfaces a tooth has; the orientation only moves them around. */
function surfacesOf(code: ToothCode): readonly SurfaceKey[] {
  return surfaceCells(code, 'patient_right_on_right');
}

/**
 * The tooltip (M14): the tooth, then what the current view shows on it, each with its surfaces,
 * date and dentist, then its open plans. A position that is not a plain natural tooth says so
 * right after its name, where a screen reader hears it first.
 */
function titleOf(
  tooth: ToothState | undefined,
  { code, view, presence, text }: ToothRenderOptions,
): string {
  const { t } = text;
  const heading = [text.label(code), text.name(code)];
  if (isPrimary(code)) heading.push(t('title.primary'));
  if (presence !== 'present') heading.push(t(`title.presence.${presence}`));

  const line = (...parts: (string | null | undefined)[]) =>
    parts.filter((part) => part).join(SEPARATOR);
  const lines: string[] = [];
  if (view !== 'services') {
    for (const item of tooth?.diagnoses ?? []) {
      lines.push(
        line(
          item.name,
          text.surfaces(item.surfaces),
          text.date(item.recordedDate),
          item.dentistName,
        ),
      );
    }
  }
  if (view !== 'diagnoses') {
    for (const item of tooth?.services ?? []) {
      const when =
        item.status === 'treated_today'
          ? t('title.today')
          : item.date === null
            ? null
            : text.date(item.date);
      lines.push(line(item.name, text.surfaces(item.surfaces), when, item.dentistName));
    }
  }
  const plans = tooth?.titleParts.plans ?? [];
  if (plans.length > 0) {
    lines.push(
      t(tooth?.planInProgress ? 'title.inProgress' : 'title.planned', {
        names: plans.join(t('title.listSeparator')),
      }),
    );
  }
  if (lines.length === 0) heading.push(t('title.noRecordedTreatment'));
  return [heading.join(SEPARATOR), ...lines].join('\n');
}

/**
 * Turns one tooth's derived state into what a glyph draws (feature 9, M1–M9, M11, M14).
 *
 * The view decides what paints: diagnoses, services, or services with the diagnoses as dots
 * (`both`). The items arrive in show-first order (priority, then the most recent).
 *
 * - **Surface mode**: each surface is painted by the first item that names it; an item on the
 *   whole tooth names all five. Whole-tooth items also get a band chip, and so does a surface
 *   item that won no surface, so nothing recorded is invisible.
 * - **Simple mode**: the first item paints the body; the others are band chips.
 * - An open plan washes whatever carries no mark, and sets the planned or in-progress ring.
 * - A missing or not-erupted position draws no fill, band or dots: only its box and the rings.
 */
export function toToothRender(
  tooth: ToothState | undefined,
  options: ToothRenderOptions,
): ToothRender {
  const { code, view, mode, presence, highlight = null, compact = false } = options;
  const diagnoses = diagnosisMarks(tooth);
  const services = serviceMarks(tooth);
  const painters = view === 'diagnoses' ? diagnoses : services;
  const dotted = view === 'both' ? diagnoses : [];

  const isHighlighted = (mark: Mark) =>
    highlight !== null && mark.kind === highlight.kind && mark.id === highlight.id;
  const openPlans = (tooth?.openPlanIds.length ?? 0) > 0;
  const inProgress = openPlans && (tooth?.planInProgress ?? false);
  const absent = presence === 'missing' || presence === 'not_erupted';

  const fillOf = (mark: Mark | undefined): Fill | null => {
    if (mark) {
      return {
        color: mark.color ?? 'none',
        tone: mark.tone,
        label: mark.label,
        ringed: isHighlighted(mark),
      };
    }
    return openPlans ? { color: 'planned', tone: 'wash', label: null, ringed: false } : null;
  };

  let body: Fill | null = null;
  const cells: Partial<Record<SurfaceKey, Fill>> = {};
  let banded: Mark[] = [];
  if (!absent && mode === 'simple') {
    const [first, ...rest] = painters;
    body = fillOf(first) ?? { color: 'none', tone: 'past', label: null, ringed: false };
    banded = rest;
  } else if (!absent) {
    const painted = new Set<Mark>();
    for (const surface of surfacesOf(code)) {
      const mark = painters.find(
        (candidate) => candidate.surfaces.length === 0 || candidate.surfaces.includes(surface),
      );
      if (mark) painted.add(mark);
      const fill = fillOf(mark);
      if (fill) cells[surface] = fill;
    }
    banded = painters.filter((mark) => mark.surfaces.length === 0 || !painted.has(mark));
  }

  const band = banded.slice(0, MAX_BAND).map((mark): BandItem => ({
    kind: mark.kind,
    id: mark.id,
    code: mark.code,
    color: mark.color,
    icon: mark.icon,
    tone: mark.tone,
    label: mark.label,
    ringed: isHighlighted(mark),
  }));
  const dots =
    absent || compact
      ? []
      : dotted.slice(0, MAX_DOTS).map((mark): Dot => ({
          color: mark.color,
          label: mark.label,
          ringed: isHighlighted(mark),
        }));

  return {
    presence,
    rings: {
      selected: options.selected ?? false,
      inProgress,
      planned: openPlans && !inProgress,
    },
    faded: highlight !== null && ![...painters, ...dotted].some(isHighlighted),
    compact,
    body,
    cells,
    band,
    // The compact chart is a summary: it shows up to three and does not count the rest.
    bandOverflow: compact ? 0 : Math.max(0, banded.length - MAX_BAND),
    dots,
    dotOverflow: dots.length === 0 ? 0 : Math.max(0, dotted.length - MAX_DOTS),
    title: titleOf(tooth, options),
  };
}
