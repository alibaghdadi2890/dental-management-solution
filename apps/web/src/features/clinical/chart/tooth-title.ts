import type { ToothState } from '@dcm/contracts';
import type { TFunction } from 'i18next';

export interface ToothTitleInput {
  /** The notation label, e.g. `#16`, `#3` or `A`. */
  label: string;
  /** The translated anatomical name. */
  name: string;
  primary: boolean;
  notErupted: boolean;
  /** Absent when nothing is recorded on the tooth (`deriveChart`'s map is sparse). */
  tooth: ToothState | undefined;
}

const SEPARATOR = ' · ';

/**
 * The tooth's hover title and accessible name (spec §Interactions → Hover), e.g.
 * `#3 · Upper right first molar · Dental caries · planned: Zircon Crown · 2 recorded services`,
 * assembled from whichever of diagnosis / plan / history exist, else "no recorded treatment".
 * Work charted in the live visit is named too, so a tooth treated today never reads as untouched.
 */
export function toothTitle(t: TFunction<'clinical'>, input: ToothTitleInput): string {
  const diagnoses = input.tooth?.titleParts.diagnoses ?? [];
  const plans = input.tooth?.titleParts.plans ?? [];
  const historyCount = input.tooth?.titleParts.historyCount ?? 0;
  const treatedToday = input.tooth?.state === 'treated_today';

  // A plain list in the locale's own comma (`، ` in Arabic), never "a and b".
  const list = (names: readonly string[]) => names.join(t('title.listSeparator'));

  const bits: string[] = [];
  if (input.primary) bits.push(t('title.primary'));
  if (input.notErupted) bits.push(t('title.notErupted'));
  if (diagnoses.length > 0) bits.push(list(diagnoses));
  if (plans.length > 0) bits.push(t('title.planned', { names: list(plans) }));
  if (historyCount > 0) bits.push(t('title.recordedServices', { count: historyCount }));
  if (treatedToday) bits.push(t('title.treatedToday'));
  if (diagnoses.length === 0 && plans.length === 0 && historyCount === 0 && !treatedToday) {
    bits.push(t('title.noRecordedTreatment'));
  }
  return [input.label, input.name, ...bits].join(SEPARATOR);
}
