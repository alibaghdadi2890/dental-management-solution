import {
  type ScheduleDentist,
  WAITLIST_VIEW_STATUSES,
  type WaitlistEntry,
  type WaitlistViewStatus,
} from '@dcm/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatPhone, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { clinicClock } from '../schedule-time';
import { invalidateSchedule } from '../scheduling-api';
import type { SlotRequestContext } from '../slot-finder';
import { SlotFinderDialog } from '../slot-finder-dialog';
import { EntryMarks, RemoveForm } from './fill-panel';
import { useAppointmentWords, useWaitedWords } from './waitlist-words';
import { removeWaitlistEntry, waitlistQuery } from './waitlist-api';
import { useWaitlistPanels } from './waitlist-context';
import { useWishesText, wishesState } from './wishes-state';

/** The view's filters, in the URL (C1). */
export interface WaitlistViewSearch {
  wstatus?: WaitlistViewStatus | undefined;
  wdentist?: string | undefined;
  wappt?: 'with' | 'without' | undefined;
  wfits?: boolean | undefined;
}

const COLUMNS =
  'minmax(10rem,1.3fr) minmax(10rem,1.3fr) minmax(7rem,0.8fr) minmax(10rem,1.2fr) minmax(7rem,0.8fr) 9rem 2.5rem';

const SEGMENT =
  'h-[26px] cursor-pointer rounded-md border-none px-3 text-[12.5px] leading-none whitespace-nowrap';

/** The slot finder for an entry (C1): its dentist, duration and dates; a move for one with a time. */
function finderContext(entry: WaitlistEntry, today: string): SlotRequestContext {
  const own = entry.appointment;
  return {
    patientId: entry.patient.id,
    patientName: entry.patient.fullName,
    reason: entry.reason,
    visitType: entry.visitType,
    durationMin: entry.durationMin,
    dentistId: entry.dentistId ?? own?.dentistId ?? null,
    pickDentist: entry.dentistId === null && own === null,
    from: today,
    to: own ? own.localDate : entry.until,
    timingLabel: '',
    planIds: entry.planIds,
    ...(entry.followUpId && !own ? { followUpId: entry.followUpId } : {}),
    ...(own ? { rescheduleId: own.id } : {}),
  };
}

/**
 * Schedule › Waitlist (C1): who waits, in the fair order, and the soonest opening each fits. The
 * history (booked, removed, expired) is newest first.
 */
export function WaitlistView({
  branchId,
  dentists,
  search,
  onSearch,
}: {
  branchId: string;
  dentists: readonly ScheduleDentist[];
  search: WaitlistViewSearch;
  onSearch: (next: WaitlistViewSearch) => void;
}) {
  const { t } = useTranslation('scheduling');
  const { openEntry } = useWaitlistPanels();
  const status = search.wstatus ?? 'waiting';
  const list = useInfiniteQuery(
    waitlistQuery({
      branchId,
      status,
      dentistId: search.wdentist,
      appointment: search.wappt,
      fits: status === 'waiting' ? search.wfits : undefined,
    }),
  );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div
          role="group"
          aria-label={t('waitlist.status')}
          className="flex rounded-lg border border-border p-0.5"
        >
          {WAITLIST_VIEW_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              className={cn(
                SEGMENT,
                status === option
                  ? 'bg-primary-tint font-semibold text-primary'
                  : 'bg-transparent text-ink-secondary',
              )}
              onClick={() => {
                onSearch({ ...search, wstatus: option === 'waiting' ? undefined : option });
              }}
            >
              {t(`waitlist.statuses.${option}`)}
            </button>
          ))}
        </div>
        <Select
          aria-label={t('toolbar.dentist')}
          className="h-[30px] w-auto"
          value={search.wdentist ?? ''}
          onChange={(event) => {
            onSearch({ ...search, wdentist: event.target.value || undefined });
          }}
        >
          <option value="">{t('waitlist.allDentists')}</option>
          {dentists.map((dentist) => (
            <option key={dentist.id} value={dentist.id}>
              {dentist.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('waitlist.appointmentFilter')}
          className="h-[30px] w-auto"
          value={search.wappt ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onSearch({
              ...search,
              wappt: value === 'with' || value === 'without' ? value : undefined,
            });
          }}
        >
          <option value="">{t('waitlist.anyAppointment')}</option>
          <option value="with">{t('waitlist.withAppointment')}</option>
          <option value="without">{t('waitlist.noAppointment')}</option>
        </Select>
        {status === 'waiting' ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
            <input
              type="checkbox"
              checked={search.wfits === true}
              onChange={(event) => {
                onSearch({ ...search, wfits: event.target.checked || undefined });
              }}
            />
            {t('waitlist.fitsFilter')}
          </label>
        ) : null}
        {openEntry ? (
          <Button
            size="sm"
            variant="primary"
            className="ms-auto"
            onClick={() => {
              openEntry({ source: 'waitlist' });
            }}
          >
            {t('waitlist.addTitle')}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="min-w-[960px]">
          <div
            className="grid h-9 items-center gap-2.5 border-b border-border px-3 text-[12px] font-medium text-ink-muted"
            style={{ gridTemplateColumns: COLUMNS }}
          >
            <span>{t('list.patient')}</span>
            <span>{t('finder.reason')}</span>
            <span>{t('list.dentist')}</span>
            <span>{t('waitlist.wishes')}</span>
            <span>{t('waitlist.waiting')}</span>
            <span />
            <span />
          </div>
          {list.isPending ? (
            <SkeletonRows columns={COLUMNS} rows={5} label={t('list.loading')} />
          ) : null}
          {list.isError ? (
            <ErrorState
              title={t('list.errorTitle')}
              body={t('list.errorBody')}
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : null}
          {list.isSuccess && items.length === 0 ? (
            <EmptyState title={t('waitlist.emptyTitle')} body="" />
          ) : null}
          {items.map((entry) => (
            <WaitlistRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
      {list.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            busy={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('list.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function WaitlistRow({ entry }: { entry: WaitlistEntry }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { openFill, openEntry } = useWaitlistPanels();
  const { openPatient } = usePatientNavigation();
  const wishesText = useWishesText();
  const appointmentWords = useAppointmentWords();
  const waited = useWaitedWords();
  const [finding, setFinding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => removeWaitlistEntry(entry.id, reason),
    onSuccess: () => invalidateSchedule(queryClient),
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });
  if (!session?.tenant) return null;
  const locale = i18n.language;
  const clock = { timeZone: session.tenant.timeZone, locale };
  const today = todayIn(session.tenant.timeZone);
  const waiting = entry.status === 'waiting';
  const date = formatCalendarDate(entry.until, locale);
  return (
    <div className="border-t border-row-divider px-3 py-2 first:border-t-0">
      <div
        className="grid min-h-10 items-center gap-2.5 text-[13px]"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span className="min-w-0">
          <Link
            to="/patients/$patientId"
            params={{ patientId: entry.patient.id }}
            className="block truncate font-medium hover:underline"
          >
            {entry.patient.fullName}
          </Link>
          {entry.callPhone ? (
            <a
              href={`tel:${entry.callPhone}`}
              dir="ltr"
              className="block font-mono text-[11.5px] text-ink-muted hover:underline"
            >
              {formatPhone(entry.callPhone, session.tenant.country)}
            </a>
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate">
            {entry.reason} · {t('panel.minutes', { count: entry.durationMin })}
          </span>
          <span className="block truncate text-[11.5px] text-ink-muted">
            {appointmentWords(entry)}
          </span>
        </span>
        <span className="truncate text-ink-secondary">
          {entry.dentistName ?? t('waitlist.anyDentist')}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-ink-secondary">{wishesText(entry.wishes)}</span>
          <span className="block truncate text-[11.5px] text-ink-muted">
            {entry.appointment ? t('waitlist.before', { date }) : t('waitlist.untilDate', { date })}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-ink-muted">
          {waiting ? waited(entry) : t(`waitlist.statuses.${entry.status}`)}
          <EntryMarks entry={entry} lateLab={false} />
        </span>
        <span>
          {entry.fits && openFill ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (entry.fits) openFill(entry.fits.openingId, entry.fits.startsAt);
              }}
            >
              {t('waitlist.fitsAt', {
                when: `${formatCalendarDate(clinicClock(entry.fits.startsAt, session.tenant.timeZone).date, locale)} · ${formatTime(entry.fits.startsAt, clock)}`,
              })}
            </Button>
          ) : null}
        </span>
        <span>
          {waiting ? (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label={t('today.more')}>
                  {'⋯'}
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  onSelect={() => {
                    setFinding(true);
                  }}
                >
                  {t('waitlist.findSlots')}
                </MenuItem>
                {openEntry ? (
                  <MenuItem
                    onSelect={() => {
                      openEntry({
                        source: 'waitlist',
                        entry,
                        wishes: wishesState(entry.wishes, entry),
                      });
                    }}
                  >
                    {t('waitlist.edit')}
                  </MenuItem>
                ) : null}
                <MenuItem
                  onSelect={() => {
                    setRemoving(true);
                  }}
                >
                  {t('waitlist.remove')}
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    openPatient(entry.patient.id);
                  }}
                >
                  {t('actions.patientRecord')}
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </span>
      </div>
      {removing ? (
        <div className="max-w-[460px]">
          <RemoveForm
            reason={reason}
            onReason={setReason}
            busy={remove.isPending}
            onCancel={() => {
              setRemoving(false);
            }}
            onRemove={() => {
              remove.mutate();
            }}
          />
        </div>
      ) : null}
      {finding ? (
        <SlotFinderDialog
          context={finderContext(entry, today)}
          onClose={() => {
            setFinding(false);
          }}
        />
      ) : null}
    </div>
  );
}
