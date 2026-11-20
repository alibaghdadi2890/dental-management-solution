import type { WaitlistWishesInput, WaitlistWishesRead } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate, formatList } from '@/lib/format';

/** The wishes as the fields hold them (A2): empty text is "not set". */
export interface WishesState {
  weekdays: number[];
  betweenFrom: string;
  betweenTo: string;
  notBefore: string;
  sameDay: boolean;
  urgent: boolean;
  note: string;
}

export const EMPTY_WISHES: WishesState = {
  weekdays: [],
  betweenFrom: '',
  betweenTo: '',
  notBefore: '',
  sameDay: false,
  urgent: false,
  note: '',
};

export function wishesState(
  wishes: WaitlistWishesRead,
  extra: { urgent: boolean; note: string | null },
): WishesState {
  return {
    weekdays: [...wishes.weekdays],
    betweenFrom: wishes.betweenFrom ?? '',
    betweenTo: wishes.betweenTo ?? '',
    notBefore: wishes.notBefore ?? '',
    sameDay: wishes.sameDay,
    urgent: extra.urgent,
    note: extra.note ?? '',
  };
}

export function wishesInput(state: WishesState): WaitlistWishesInput {
  const between = state.betweenFrom !== '' && state.betweenTo !== '';
  return {
    weekdays: state.weekdays,
    betweenFrom: between ? state.betweenFrom : null,
    betweenTo: between ? state.betweenTo : null,
    notBefore: state.notBefore || null,
    sameDay: state.sameDay,
    urgent: state.urgent,
    note: state.note.trim() || null,
  };
}

/** Both times or neither, the first before the second. */
export const wishesValid = (state: WishesState) =>
  (state.betweenFrom === '') === (state.betweenTo === '') &&
  (state.betweenFrom === '' || state.betweenFrom < state.betweenTo);

/** Monday first: the clinic's week. */
export const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const weekdayName = (weekday: number, locale: string) =>
  // 2026-11-01 is a Sunday: day `weekday` of that week.
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 10, 1 + weekday)),
  );

export const clockText = (time: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(`2000-01-01T${time}:00Z`),
  );

/** "Mon–Wed": runs of the week joined, the rest listed. */
function daysText(weekdays: readonly number[], locale: string): string {
  const ordered = WEEK.filter((day) => weekdays.includes(day));
  const runs: number[][] = [];
  for (const day of ordered) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last !== undefined && WEEK.indexOf(day) === WEEK.indexOf(last) + 1) {
      run.push(day);
    } else runs.push([day]);
  }
  return formatList(
    runs.map((run) => {
      const first = run[0] ?? 0;
      const last = run.at(-1) ?? first;
      return run.length > 2
        ? `${weekdayName(first, locale)}–${weekdayName(last, locale)}`
        : run.map((day) => weekdayName(day, locale)).join(', ');
    }),
    locale,
  );
}

/** The wishes in a few words: "Mon–Wed · 2:00 PM–6:00 PM · from 1 Dec · same day". */
export function useWishesText(): (wishes: WaitlistWishesRead) => string {
  const { t, i18n } = useTranslation('scheduling');
  const locale = i18n.language;
  return (wishes) =>
    [
      wishes.weekdays.length > 0 ? daysText(wishes.weekdays, locale) : t('waitlist.anyDay'),
      wishes.betweenFrom && wishes.betweenTo
        ? `${clockText(wishes.betweenFrom, locale)}–${clockText(wishes.betweenTo, locale)}`
        : null,
      wishes.notBefore
        ? t('waitlist.fromDate', { date: formatCalendarDate(wishes.notBefore, locale) })
        : null,
      wishes.sameDay ? t('waitlist.sameDayShort') : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
}
