import {
  formatVisitNumber,
  type PatientChart,
  type ToothCode,
  type ToothPresenceRecord,
} from '@dcm/contracts';
import type { TFunction } from 'i18next';
import { formatCalendarDate } from '@/lib/format';

/**
 * How a presence row reads (feature 7, H1, H3a): in the words it was recorded with, and nothing
 * more. "Missing since 12 Mar 2026 · Extraction, visit V-000045", "Missing · before first
 * visit", "Missing since 3 Jun 2026 · accident · recorded by Dr. Haddad". A row without a date is
 * never given one.
 */

const SEPARATOR = ' · ';

/** The tooth's latest row: its presence now, with where it came from. Undefined when the tooth
 * was never anything but present. */
export function latestPresence(
  chart: Pick<PatientChart, 'presence'>,
  code: ToothCode,
): ToothPresenceRecord | undefined {
  return chart.presence.findLast((row) => row.toothCode === code);
}

/** What follows the state: the service or visit, "before first visit", the reason, the author. */
function origin(t: TFunction<'clinical'>, row: ToothPresenceRecord): string[] {
  const parts: string[] = [];
  const number = row.visitNumber === null ? null : formatVisitNumber(row.visitNumber);
  if (row.serviceName !== null && number !== null) {
    parts.push(t('presence.banner.service', { name: row.serviceName, number }));
  } else if (number !== null) {
    parts.push(t('presence.banner.visit', { number }));
  } else if (row.occurredOn === null) {
    parts.push(t('presence.banner.beforeFirstVisit'));
  }
  if (row.reason) parts.push(row.reason);
  // A service says who did it through its visit; a presence set by hand names its dentist.
  if (row.serviceId === null && row.dentistName !== '') {
    parts.push(t('presence.banner.recordedBy', { name: row.dentistName }));
  }
  return parts;
}

/** The one-line banner under the tooth's title. */
export function presenceBanner(
  t: TFunction<'clinical'>,
  row: ToothPresenceRecord,
  locale: string,
): string {
  const state = t(`presence.states.${row.presence}`);
  const head =
    row.occurredOn === null
      ? state
      : t('presence.banner.since', { state, date: formatCalendarDate(row.occurredOn, locale) });
  return [head, ...origin(t, row)].join(SEPARATOR);
}

/** A tooth-history entry: "Marked missing" and, under it, where that came from. */
export function presenceEntry(
  t: TFunction<'clinical'>,
  row: ToothPresenceRecord,
): { title: string; detail: string } {
  const number = row.visitNumber === null ? null : formatVisitNumber(row.visitNumber);
  const detail =
    row.serviceName !== null && row.serviceCode !== null && number !== null
      ? [
          t('presence.history.service', {
            name: row.serviceName,
            code: row.serviceCode,
            number,
          }),
        ]
      : origin(t, row);
  return { title: t(`presence.history.marked.${row.presence}`), detail: detail.join(SEPARATOR) };
}
