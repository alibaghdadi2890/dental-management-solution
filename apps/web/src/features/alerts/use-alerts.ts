import { ALERT_TRAY_EVENT } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { visitKeys } from '@/features/clinical/visits-api';
import { visitListKeys } from '@/features/clinical/visits-list/visits-list-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { invalidateSchedule } from '@/features/scheduling/scheduling-api';
import { API_BASE } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { diffTray, readKeys, type TrayItem, writeKeys } from './alert-diff';
import { useAlertLeader } from './alert-leader';
import { notifyDesktop, useAlertPreferences } from './alert-preferences';
import { alertKeys, alertTrayQuery } from './alerts-api';
import { chime, unlockSound } from './chime';

/** Pings that arrive together (a start moves a visit and its appointment) refetch once. */
const COALESCE_MS = 300;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

export const seenKey = (userId: string) => `dcm.alerts.seen.${userId}`;
export const openedKey = (userId: string) => `dcm.alerts.opened.${userId}`;

/**
 * The tray's data and its alerts (spec §The tray): for people who run visits, in a clinic of their
 * own (a platform admin acting in one has no stream: `EventSource` can't send the tenant header).
 * The stream's pings refetch the tray; the tab that holds the lock compares it with what this
 * browser has seen and alerts for the rest.
 */
export function useAlertTray() {
  const { data: session } = useSession();
  const enabled =
    session?.tenant != null &&
    !session.platformAdmin &&
    session.permissions.includes('visit:write');
  const tenantId = session?.tenant?.id;
  const userId = session?.user.id;
  const tray = useQuery(alertTrayQuery(tenantId, enabled));
  const queryClient = useQueryClient();

  useEffect(() => {
    // Without EventSource (an old browser, a test page) the tray still polls.
    if (!enabled || typeof EventSource === 'undefined') return;
    const stopUnlock = unlockSound();
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = RETRY_MIN_MS;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: alertKeys.tray(tenantId) });
        // What else on screen shows who arrived and who is in a room: the calendar and the
        // Today board, and the live visits. Only what is mounted refetches.
        void invalidateSchedule(queryClient);
        void queryClient.invalidateQueries({ queryKey: visitKeys.allLive(actingTenantId()) });
        void queryClient.invalidateQueries({ queryKey: visitListKeys.lists(actingTenantId()) });
      }, COALESCE_MS);
    };
    // EventSource retries a dropped connection by itself, but gives up on an error answer (a 502
    // while the API restarts on a deploy): then it is opened again, backing off to a minute.
    const connect = () => {
      const opened = new EventSource(`${API_BASE}/alerts/stream`, { withCredentials: true });
      source = opened;
      opened.addEventListener(ALERT_TRAY_EVENT, refetch);
      // (Re)connected: whatever happened meanwhile.
      opened.addEventListener('open', () => {
        delay = RETRY_MIN_MS;
        refetch();
      });
      opened.addEventListener('error', () => {
        if (opened.readyState !== EventSource.CLOSED) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      });
    };
    connect();
    return () => {
      clearTimeout(timer);
      clearTimeout(retry);
      source?.close();
      stopUnlock();
    };
  }, [enabled, tenantId, queryClient]);

  const leader = useAlertLeader(enabled);
  const announce = useEffectEvent(useAnnounce());
  // Who the caller follows when the tray was last compared: following someone records what they
  // already have rather than alerting for all of it.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!leader || !tray.data || !userId) return;
    const follows = [...tray.data.follows].sort().join();
    const changed = followed.current !== null && followed.current !== follows;
    followed.current = follows;
    const stored = readKeys(seenKey(userId));
    const { alerts, seen } = diffTray(changed ? null : stored, tray.data, userId);
    writeKeys(seenKey(userId), seen);
    for (const alert of alerts) announce(alert);
  }, [leader, tray.data, userId]);

  return { enabled, tray, userId };
}

/** One alert: a toast that stays until dealt with, the chime, a Windows notification when hidden. */
function useAnnounce() {
  const { t, i18n } = useTranslation('alerts');
  const toast = useToast();
  const navigate = useNavigate();
  const preferences = useAlertPreferences();
  const { data: session } = useSession();
  const timeZone = session?.tenant?.timeZone ?? 'UTC';

  return (alert: TrayItem) => {
    const open = () => {
      if (alert.kind === 'started') {
        void navigate({ to: '/visits/$visitId', params: { visitId: alert.item.visitId } });
      } else {
        void navigate({ to: '/schedule', search: { appointment: alert.item.appointmentId } });
      }
    };
    const { patientName, dentistName, roomName } = alert.item;
    const title =
      alert.kind === 'arrived'
        ? t('alert.arrived', { patient: patientName })
        : roomName
          ? t('alert.startedInRoom', { patient: patientName, room: roomName })
          : t('alert.started', { patient: patientName });
    const body =
      alert.kind === 'arrived'
        ? t('alert.arrivedBody', {
            dentist: dentistName,
            time: formatTime(alert.item.startsAt, { timeZone, locale: i18n.language }),
          })
        : t('alert.startedBody', { dentist: dentistName, starter: alert.item.startedByName });
    toast(title, {
      tone: 'info',
      body,
      actionLabel: t('alert.open'),
      onAction: open,
      sticky: true,
    });
    if (preferences.sound) chime(alert.kind);
    if (preferences.desktop) notifyDesktop(title, body, alert.key, open);
  };
}
