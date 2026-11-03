import type { AlertInRoom, AlertTray, AlertWaiting } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Popover } from 'radix-ui';
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { useElapsedText } from '@/features/clinical/use-visit-timer';
import { practitionersQuery } from '@/features/users/users-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { firstName } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { readKeys, trayItems, unreadKeys, writeKeys } from './alert-diff';
import { desktopPermission, setAlertPreferences, useAlertPreferences } from './alert-preferences';
import { alertKeys, setAlertFollows } from './alerts-api';
import { soundBlocked, subscribeSound } from './chime';
import { openedKey, useAlertTray } from './use-alerts';

const PILL =
  'flex h-8 flex-none cursor-pointer items-center gap-2 rounded-[7px] border px-3 text-[12.5px] leading-none font-medium whitespace-nowrap';

function PeopleIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12.2 10.3c1.1.5 1.9 1.6 2.3 3.2" />
    </svg>
  );
}

/**
 * "Your patients" in the header (feature 15, spec §The tray): who is waiting for the caller's
 * dentists and who is in a room, each one click from where it is worked on; how alerts sound on
 * this computer; whom the caller follows. It replaces the live-visit pill: visits the caller
 * started are in it too. Nothing for people who don't run visits.
 */
export function PatientsTray() {
  const { t } = useTranslation('alerts');
  const { enabled, tray, userId } = useAlertTray();
  const [open, setOpen] = useState(false);
  // What the list showed when last opened; read from this browser until it is opened here.
  const [openedHere, setOpened] = useState<ReadonlySet<string> | null>(null);
  const opened = openedHere ?? (userId ? readKeys(openedKey(userId)) : null) ?? new Set<string>();
  const titleId = useId();
  if (!enabled || !userId) return null;

  const data = tray.data;
  const count = data ? data.waiting.length + data.inRoom.length : 0;
  const unread = data ? unreadKeys(data, opened, userId) : [];
  const markOpened = () => {
    if (!data) return;
    const keys = new Set(trayItems(data).map((entry) => entry.key));
    writeKeys(openedKey(userId), keys);
    setOpened(keys);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // What was new is seen once the list closes, so it stays marked while it is read.
        if (!next) markOpened();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('tray.label', { count })}
          className={cn(
            PILL,
            count === 0
              ? 'border-border bg-surface text-ink-muted hover:border-border-strong'
              : 'border-primary-tint-border bg-primary-tint text-primary hover:border-primary-tint-strong',
          )}
        >
          <span className="relative flex">
            <PeopleIcon />
            {unread.length > 0 ? (
              <span
                aria-hidden
                className="absolute -end-1 -top-1 size-2 animate-pulsedot rounded-full bg-primary"
              />
            ) : null}
          </span>
          {count > 0 ? (
            <TrayFace tray={data} />
          ) : (
            <span className="sr-only">{t('tray.title')}</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-labelledby={titleId}
          className="z-40 flex max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-24px)] animate-fadein flex-col overflow-hidden rounded-[10px] border border-border bg-surface shadow-[0_10px_28px_rgba(27,26,31,.14)]"
        >
          <h2
            id={titleId}
            className="m-0 flex-none px-4 pt-3.5 pb-2 text-[14px] leading-none font-semibold"
          >
            {t('tray.title')}
          </h2>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {data ? (
              <TrayList
                tray={data}
                receivedAt={tray.dataUpdatedAt}
                unread={new Set(unread)}
                onPick={() => {
                  setOpen(false);
                  markOpened();
                }}
              />
            ) : (
              <p className="m-0 px-2 py-3 text-[12.5px] text-ink-muted">
                {tray.isError ? t('tray.failed') : t('tray.loading')}
              </p>
            )}
          </div>
          <TraySettings follows={data?.follows ?? []} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The button's words: one person by name, else how many. */
function TrayFace({ tray }: { tray: AlertTray | undefined }) {
  const { t } = useTranslation('alerts');
  if (!tray) return null;
  const [only] = [...tray.inRoom, ...tray.waiting];
  if (only && tray.inRoom.length + tray.waiting.length === 1) {
    return (
      <span>
        {'visitId' in only
          ? t('tray.oneInRoom', { name: firstName(only.patientName) })
          : t('tray.oneWaiting', { name: firstName(only.patientName) })}
      </span>
    );
  }
  return <span>{t('tray.several', { count: tray.inRoom.length + tray.waiting.length })}</span>;
}

function TrayList({
  tray,
  receivedAt,
  unread,
  onPick,
}: {
  tray: AlertTray;
  receivedAt: number;
  unread: ReadonlySet<string>;
  onPick: () => void;
}) {
  const { t } = useTranslation('alerts');
  const navigate = useNavigate();
  if (tray.inRoom.length === 0 && tray.waiting.length === 0) {
    return (
      <p className="m-0 px-2 py-3 text-[12.5px] leading-snug text-ink-muted">
        {t(tray.follows.length === 0 ? 'tray.emptyNoFollows' : 'tray.empty')}
      </p>
    );
  }
  return (
    <>
      {tray.inRoom.length > 0 ? (
        <Section title={t('tray.inRoom')}>
          {tray.inRoom.map((visit) => (
            <InRoomRow
              key={visit.visitId}
              visit={visit}
              serverNow={tray.serverNow}
              receivedAt={receivedAt}
              unread={unread.has(`started:${visit.visitId}`)}
              onOpen={() => {
                onPick();
                void navigate({ to: '/visits/$visitId', params: { visitId: visit.visitId } });
              }}
            />
          ))}
        </Section>
      ) : null}
      {tray.waiting.length > 0 ? (
        <Section title={t('tray.waiting')}>
          {tray.waiting.map((item) => (
            <WaitingRow
              key={item.appointmentId}
              item={item}
              unread={unread.has(`arrived:${item.appointmentId}`)}
              onOpen={() => {
                onPick();
                void navigate({ to: '/schedule', search: { appointment: item.appointmentId } });
              }}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-1.5">
      <h3
        id={id}
        className="m-0 px-2 pt-1.5 pb-1 text-[11px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {title}
      </h3>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

function Row({
  unread,
  onOpen,
  name,
  detail,
  trailing,
}: {
  unread: boolean;
  onOpen: () => void;
  name: string;
  detail: string;
  trailing: ReactNode;
}) {
  const { t } = useTranslation('alerts');
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none px-2 py-2 text-start hover:bg-faint',
          unread ? 'bg-primary-tint' : 'bg-transparent',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] leading-tight font-medium">
            <span className="truncate">{name}</span>
            {unread ? (
              <span className="flex-none rounded-[4px] bg-primary px-1 text-[10px] leading-[15px] font-semibold text-primary-foreground">
                {t('tray.new')}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-ink-muted">
            {detail}
          </span>
        </span>
        <span className="flex-none text-[12px] text-ink-secondary">{trailing}</span>
      </button>
    </li>
  );
}

function InRoomRow({
  visit,
  serverNow,
  receivedAt,
  unread,
  onOpen,
}: {
  visit: AlertInRoom;
  serverNow: string;
  receivedAt: number;
  unread: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation('alerts');
  const elapsed = useElapsedText({ ...visit, serverNow }, receivedAt);
  const detail = [
    visit.roomName,
    visit.dentistName,
    t('tray.startedBy', { name: visit.startedByName }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Row
      unread={unread}
      onOpen={onOpen}
      name={visit.patientName}
      detail={detail}
      trailing={
        <span dir="ltr" className="font-mono font-semibold text-primary tabular-nums">
          {visit.status === 'paused' ? t('tray.paused') : elapsed}
        </span>
      }
    />
  );
}

function WaitingRow({
  item,
  unread,
  onOpen,
}: {
  item: AlertWaiting;
  unread: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation('alerts');
  const now = useMinuteClock();
  const minutes = Math.max(0, Math.floor((now - Date.parse(item.checkedInAt)) / 60_000));
  const detail = [item.roomName, item.dentistName].filter(Boolean).join(' · ');
  return (
    <Row
      unread={unread}
      onOpen={onOpen}
      name={item.patientName}
      detail={detail}
      trailing={t('tray.waitingFor', { count: minutes })}
    />
  );
}

/** The time now, to the minute: how long someone has waited. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** This computer's sound and Windows notifications (D7), and whom the caller follows (D3). */
function TraySettings({ follows }: { follows: readonly string[] }) {
  const { t } = useTranslation('alerts');
  const preferences = useAlertPreferences();
  const blocked = useSyncExternalStore(subscribeSound, soundBlocked, () => false);
  const [permission, setPermission] = useState(desktopPermission);
  const canFollow = usePermission('visit:read_all');
  return (
    <div className="flex flex-none flex-col gap-2.5 border-t border-inner-divider px-4 py-3 text-[12.5px]">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block">{t('settings.sound')}</span>
          {preferences.sound && blocked ? (
            <span className="block text-[11.5px] text-warning">{t('settings.soundBlocked')}</span>
          ) : null}
        </span>
        <Switch
          label={t('settings.sound')}
          checked={preferences.sound}
          onCheckedChange={(sound) => {
            setAlertPreferences({ sound });
          }}
        />
      </div>
      {permission === 'unsupported' ? null : (
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1">
            <span className="block">{t('settings.desktop')}</span>
            {permission === 'denied' ? (
              <span className="block text-[11.5px] text-ink-muted">
                {t('settings.desktopDenied')}
              </span>
            ) : null}
          </span>
          <Switch
            label={t('settings.desktop')}
            disabled={permission === 'denied'}
            checked={preferences.desktop && permission === 'granted'}
            onCheckedChange={(desktop) => {
              if (!desktop || permission === 'granted') {
                setAlertPreferences({ desktop });
                return;
              }
              void Notification.requestPermission().then((answer) => {
                setPermission(answer);
                setAlertPreferences({ desktop: answer === 'granted' });
              });
            }}
          />
        </div>
      )}
      {canFollow ? <FollowDentists follows={follows} /> : null}
    </div>
  );
}

function FollowDentists({ follows }: { follows: readonly string[] }) {
  const { t, i18n } = useTranslation('alerts');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const dentists = useQuery(practitionersQuery());
  const own = session?.profile?.id;
  const save = useMutation({
    mutationFn: setAlertFollows,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: alertKeys.tray(session?.tenant?.id) }),
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });
  const others = (dentists.data ?? []).filter((dentist) => dentist.id !== own);
  if (others.length === 0) return null;
  const following = new Set(save.isPending ? save.variables.dentistIds : follows);
  return (
    <fieldset className="m-0 border-none p-0">
      <legend className="mb-1.5 p-0 text-[11.5px] text-ink-muted">{t('settings.follow')}</legend>
      <div className="flex flex-col gap-1">
        {others.map((dentist) => (
          <label key={dentist.id} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={following.has(dentist.id)}
              onChange={(event) => {
                const next = new Set(following);
                if (event.target.checked) next.add(dentist.id);
                else next.delete(dentist.id);
                save.mutate({ dentistIds: [...next] });
              }}
            />
            {dentist.displayName}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
