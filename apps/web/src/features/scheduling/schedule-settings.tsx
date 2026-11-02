import { type OpeningDay, WEEKDAYS } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select, TextInput } from '@/components/ui/field';
import { SaveBar } from '@/components/ui/save-bar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { apiErrorMessage } from '@/lib/api-error-message';
import { clockOf } from './schedule-time';
import {
  invalidateSchedule,
  openingHoursQuery,
  saveOpeningHours,
  saveSchedulingSettings,
  schedulingSettingsQuery,
} from './scheduling-api';

const TIMES = Array.from({ length: 96 }, (_, index) => clockOf(index * 15));

/** Monday first, as the clinic's week reads; Sunday (0) last. */
const WEEK = [...WEEKDAYS.slice(1), 0];

const weekdayName = (weekday: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    // 2026-11-01 is a Sunday.
    new Date(Date.UTC(2026, 10, 1 + weekday)),
  );

/** *Settings › Schedule* (A19): the branch's hours and the follow-up window, with one save bar. */
export function ScheduleSettings() {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const branches = session?.branches ?? [];
  const [branchId, setBranchId] = useState(session?.branch?.id ?? branches[0]?.id ?? '');
  const hours = useQuery(openingHoursQuery(branchId));
  const settings = useQuery(schedulingSettingsQuery());
  const [draftDays, setDraftDays] = useState<OpeningDay[] | null>(null);
  const [draftWindow, setDraftWindow] = useState<string | null>(null);
  const days = draftDays ?? hours.data?.days ?? [];
  const windowText = draftWindow ?? String(settings.data?.followUpWindowDays ?? '');
  const windowDays = Number(windowText);
  const windowValid = Number.isInteger(windowDays) && windowDays >= 1 && windowDays <= 365;
  const invalidDay = days.some((day) => day.isOpen && day.from >= day.to);
  const dirty = draftDays !== null || draftWindow !== null;

  const save = useMutation({
    mutationFn: async () => {
      if (draftDays) await saveOpeningHours(branchId, { days: draftDays });
      if (draftWindow !== null) await saveSchedulingSettings({ followUpWindowDays: windowDays });
    },
    onSuccess: async () => {
      setDraftDays(null);
      setDraftWindow(null);
      toast(t('settings.saved'));
      await invalidateSchedule(queryClient);
    },
    onError: (error) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  });

  const change = (weekday: number, patch: Partial<OpeningDay>) => {
    setDraftDays(days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
  };

  return (
    <div className="flex max-w-[620px] flex-col gap-5 pb-20">
      {branches.length > 1 ? (
        <Field label={t('settings.branch')}>
          {(field) => (
            <Select
              {...field}
              value={branchId}
              onChange={(event) => {
                setDraftDays(null);
                setBranchId(event.target.value);
              }}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <section>
        <h2 className="m-0 mb-1 text-[14px] font-semibold">{t('settings.hours')}</h2>
        <p className="m-0 mb-3 text-[12.5px] text-ink-muted">{t('settings.hoursHint')}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {WEEK.map((weekday) => {
            const day = days.find((candidate) => candidate.weekday === weekday);
            if (!day) return null;
            const name = weekdayName(weekday, i18n.language);
            return (
              <li key={weekday} className="flex items-center gap-3 text-[13px]">
                <span className="w-[110px]">{name}</span>
                <Switch
                  label={t('settings.open', { day: name })}
                  checked={day.isOpen}
                  onCheckedChange={(isOpen) => {
                    change(weekday, { isOpen });
                  }}
                />
                {day.isOpen ? (
                  <>
                    <Select
                      className="w-[100px]"
                      aria-label={t('settings.from', { day: name })}
                      value={day.from}
                      onChange={(event) => {
                        change(weekday, { from: event.target.value });
                      }}
                    >
                      {TIMES.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </Select>
                    <Select
                      className="w-[100px]"
                      aria-label={t('settings.to', { day: name })}
                      value={day.to}
                      onChange={(event) => {
                        change(weekday, { to: event.target.value });
                      }}
                    >
                      {TIMES.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </Select>
                    {day.from >= day.to ? (
                      <span className="text-[12px] text-danger">{t('settings.range')}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-muted">{t('settings.closed')}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="m-0 mb-1 text-[14px] font-semibold">{t('settings.window')}</h2>
        <p className="m-0 mb-2 text-[12.5px] text-ink-muted">{t('settings.windowHint')}</p>
        <label className="flex items-center gap-2 text-[13px]">
          <TextInput
            type="number"
            min={1}
            max={365}
            className="w-[90px]"
            aria-label={t('settings.window')}
            value={windowText}
            onChange={(event) => {
              setDraftWindow(event.target.value);
            }}
          />
          {t('settings.days')}
        </label>
      </section>
      {dirty ? (
        <SaveBar
          label={t('settings.unsaved')}
          {...(invalidDay || !windowValid ? { error: t('settings.invalid') } : {})}
          saving={save.isPending}
          onSave={() => {
            save.mutate();
          }}
          onDiscard={() => {
            setDraftDays(null);
            setDraftWindow(null);
          }}
        />
      ) : null}
    </div>
  );
}
