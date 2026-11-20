import type { WaitlistEntry, WaitlistOpening } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { formatCalendarDate, formatTime } from '@/lib/format';

const DAY_MS = 86_400_000;

/** The openings of Today's lane: someone fits them and nobody left them open (C3). */
export const toFill = (openings: readonly WaitlistOpening[]) =>
  openings.filter((opening) => opening.fitCount > 0 && !opening.leftOpen);

/** "Has Thu 10 Dec · 10:00" or "No appointment". */
export function useAppointmentWords(): (entry: WaitlistEntry) => string {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const clock = { timeZone: session?.tenant?.timeZone ?? 'UTC', locale: i18n.language };
  return (entry) => {
    const held = entry.appointment ?? entry.otherAppointment;
    return held
      ? t('waitlist.has', {
          when: `${formatCalendarDate(held.localDate, i18n.language)} · ${formatTime(held.startsAt, clock)}`,
        })
      : t('waitlist.noAppointment');
  };
}

export function useWaitedWords(): (entry: WaitlistEntry) => string {
  const { t } = useTranslation('scheduling');
  return (entry) => {
    const days = Math.floor((Date.now() - Date.parse(entry.createdAt)) / DAY_MS);
    return days < 1 ? t('waitlist.addedToday') : t('waitlist.waited', { count: days });
  };
}
