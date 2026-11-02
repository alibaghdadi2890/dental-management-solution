import {
  type FollowUp,
  FOLLOW_UP_KIND_DEFAULTS,
  followUpSearchWindow,
  type Visit,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { patientAppointmentsQuery, patientFollowUpsQuery } from './scheduling-api';
import { SlotFinder } from './slot-finder';
import { useFollowUpOutcomes } from './use-follow-up-outcomes';

/** The reason of *Patient declined…*: optional, then the outcome. */
export function DeclineForm({ onDecline }: { onDecline: (reason: string) => void }) {
  const { t } = useTranslation('scheduling');
  const [reason, setReason] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <TextInput
        value={reason}
        maxLength={500}
        aria-label={t('followUp.declineReason')}
        placeholder={t('followUp.declineReason')}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          onDecline(reason);
        }}
      >
        {t('followUp.declineConfirm')}
      </Button>
    </div>
  );
}

/** The follow-up card's facts (A14). */
function FollowUpCard({ followUp }: { followUp: FollowUp }) {
  const { t, i18n } = useTranslation('scheduling');
  const facts: [string, string][] = [
    [t('followUp.recommendedBy'), followUp.recommendedByName],
    [t('followUp.duration'), t('panel.minutes', { count: followUp.durationMin })],
    [
      t('followUp.timing'),
      followUp.dueOn
        ? `${t(`timings.${followUp.timing}`)} · ${formatCalendarDate(followUp.dueOn, i18n.language)}`
        : t(`timings.${followUp.timing}`),
    ],
    [t('followUp.preferredDentist'), followUp.preferredDentistName ?? '—'],
  ];
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-semibold">{followUp.title}</p>
          <p className="m-0 mt-0.5 text-[12px] text-ink-muted">
            {t('followUp.fromVisit', {
              visit: `V-${String(followUp.sourceVisitNumber).padStart(6, '0')}`,
            })}
          </p>
        </div>
        <span className="flex-none rounded-[4px] border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[11px] font-medium text-warning">
          {followUp.willCallAt ? t('followUp.willCall') : t('followUp.awaiting')}
        </span>
      </div>
      <dl className="m-0 mt-2.5 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="m-0">{value}</dd>
          </div>
        ))}
      </dl>
      {followUp.note ? <p className="m-0 mt-2 text-[12.5px]">{followUp.note}</p> : null}
      {followUp.clinicalPrep ? (
        <p className="m-0 mt-1 text-[12.5px] text-ink-secondary">
          <span className="font-medium">{t('followUp.clinicalPrep')}</span> {followUp.clinicalPrep}
        </p>
      ) : null}
    </div>
  );
}

/** The checkout's *Next appointment* step (A14). Done closes the checkout whatever happens here. */
export function CheckoutNextStep({ visit }: { visit: Visit }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canWrite = usePermission('appointment:write_all');
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const today = todayIn(timeZone);
  const followUps = useQuery(patientFollowUpsQuery(visit.patientId));
  const appointments = useQuery(patientAppointmentsQuery(visit.patientId));
  const followUp = followUps.data?.find((row) => row.sourceVisitId === visit.id);
  const [finding, setFinding] = useState(false);
  const [declining, setDeclining] = useState(false);
  const { willCall, decline } = useFollowUpOutcomes();
  if (!followUps.data) return null;

  if (!followUp) {
    return <p className="m-0 text-[13px] text-ink-secondary">{t('followUp.none')}</p>;
  }
  const holder = appointments.data?.find((row) => row.id === followUp.appointmentId);
  if (followUp.status === 'booked' && holder) {
    const clock = { timeZone, locale: i18n.language };
    return (
      <div className="rounded-lg border border-success-border bg-success-bg p-3 text-[13px]">
        <p className="m-0 font-semibold text-success">{t('next.booked')}</p>
        <p className="m-0 mt-0.5">
          {followUp.title} · {formatCalendarDate(holder.localDate, i18n.language)} ·{' '}
          {formatTime(holder.startsAt, clock)} · {holder.dentistName}
        </p>
      </div>
    );
  }
  if (followUp.status === 'declined') {
    return (
      <p className="m-0 text-[13px] text-ink-secondary">
        {t('followUp.declined', { reason: followUp.declinedReason ?? '' })}
      </p>
    );
  }
  if (finding) {
    const window = followUpSearchWindow(followUp, today);
    return (
      <SlotFinder
        context={{
          patientId: followUp.patientId,
          patientName: followUp.patientName,
          reason: followUp.title,
          visitType: FOLLOW_UP_KIND_DEFAULTS[followUp.kind].visitType,
          durationMin: followUp.durationMin,
          dentistId: followUp.preferredDentistId,
          pickDentist: !followUp.preferredDentistAvailable,
          from: window.from,
          to: window.to,
          timingLabel: t(`timings.${followUp.timing}`),
          planIds: followUp.planIds,
          followUpId: followUp.id,
          invalidReason: followUp.invalidReason,
          recommender: followUp.recommendedByName,
        }}
        cancelLabel={t('followUp.back')}
        onCancel={() => {
          setFinding(false);
        }}
        onBooked={() => {
          setFinding(false);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <FollowUpCard followUp={followUp} />
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setFinding(true);
            }}
          >
            {t('followUp.find')}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="secondary">
                {t('followUp.notBooking')}
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              {followUp.willCallAt ? null : (
                <MenuItem
                  onSelect={() => {
                    willCall.mutate(followUp.id);
                  }}
                >
                  {t('followUp.markWillCall')}
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  setDeclining(true);
                }}
              >
                {t('followUp.markDeclined')}
              </MenuItem>
              <MenuItem onSelect={() => undefined}>{t('followUp.leavePending')}</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ) : null}
      {declining ? (
        <DeclineForm
          onDecline={(reason) => {
            decline.mutate({ id: followUp.id, reason });
            setDeclining(false);
          }}
        />
      ) : null}
    </div>
  );
}
