import {
  type Appointment,
  canWriteAppointment,
  combineProposals,
  FOLLOW_UP_DURATION_MAX,
  FOLLOW_UP_KIND_DEFAULTS,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_TIMINGS,
  followUpDueOn,
  type FollowUpKind,
  followUpSearchWindow,
  type FollowUpTiming,
  type NextAppointmentProposal,
  type NextAppointmentRequest,
  type PatientChart,
  proposeNextAppointment,
  SLOT_LENGTHS,
  type Visit,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DialogSteps } from './dialog-steps';
import { patientAppointmentsQuery, resourcesQuery } from './scheduling-api';
import { SlotFinder } from './slot-finder';

const chipClass = (on: boolean) =>
  cn(
    'h-[30px] cursor-pointer rounded-md border px-2.5 text-[12.5px] whitespace-nowrap',
    on
      ? 'border-primary bg-primary-tint font-semibold text-primary'
      : 'border-border-control bg-surface text-ink',
  );

/** "Root canal treatment" → "root canal treatment", inside a sentence. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * **Next appointment** (A13, D1): what the dentist recommends, between the check before Complete and
 * the payment. Proposals come from the chart (`proposeNextAppointment`); nothing here waits on a
 * slot. *Book now* books before completion, and the completion then carries the appointment (A15).
 */
export function NextAppointmentDialog({
  visit,
  chart,
  patientName,
  completing,
  onBack,
  onComplete,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  patientName: string;
  completing: boolean;
  onBack: () => void;
  onComplete: (nextAppointment: NextAppointmentRequest | undefined) => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const toothLabel = useToothLabel();
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const today = todayIn(timeZone);
  const proposals = useMemo(
    () => proposeNextAppointment(chart?.plans ?? [], visit.id),
    [chart, visit.id],
  );
  const top = proposals[0];
  const [selected, setSelected] = useState<readonly NextAppointmentProposal[]>(top ? [top] : []);
  const [kind, setKind] = useState<FollowUpKind | null>(null);
  const [otherText, setOtherText] = useState('');
  const combined = selected.length > 0 ? combineProposals(selected) : null;
  const [durationMin, setDurationMin] = useState(combined?.durationMin ?? 30);
  const [timing, setTiming] = useState<FollowUpTiming>(combined?.timing ?? 'within_2_weeks');
  const [customDate, setCustomDate] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dentistId, setDentistId] = useState(visit.dentistId);
  const [note, setNote] = useState('');
  const [clinicalPrep, setClinicalPrep] = useState('');
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<Appointment | null>(null);

  const canRead = usePermission('appointment:read');
  const resources = useQuery({ ...resourcesQuery(visit.branchId), enabled: canRead });
  // A dialog reopened after a booking finds it: the booking is real whatever happened next (A15).
  const existing = useQuery({
    ...patientAppointmentsQuery(visit.patientId, canRead),
    select: (rows) =>
      rows.find(
        (row) =>
          row.sourceVisitId === visit.id && (row.status === 'booked' || row.status === 'confirmed'),
      ) ?? null,
  });
  // The fresh row first: it may have been moved since; `booked` covers the refetch.
  const holding = existing.data ?? booked;

  const proposalTitle = (proposal: NextAppointmentProposal) => {
    const where = proposal.toothCode ? ` — ${toothLabel(proposal.toothCode)}` : '';
    return proposal.kind === 'continue_treatment'
      ? `${t('next.continue', { name: lowerFirst(proposal.name) })}${where}`
      : `${proposal.name}${where}`;
  };
  const title =
    selected.length > 0
      ? selected.map(proposalTitle).join(' + ')
      : kind === 'other'
        ? otherText.trim() || t('kinds.other')
        : kind
          ? t(`kinds.${kind}`)
          : '';
  const firstSelected = selected[0];
  const chosenKind: FollowUpKind | null = firstSelected?.kind ?? kind;
  const custom = timing === 'custom';
  const customMissing = custom && customDate === '';
  const hasChoice = chosenKind !== null;

  const payload = (): NextAppointmentRequest | undefined => {
    if (holding) {
      // What was booked is what the follow-up says, whatever the form shows on a reopened dialog.
      const minutes = (Date.parse(holding.endsAt) - Date.parse(holding.startsAt)) / 60_000;
      return {
        kind: chosenKind ?? 'general_follow_up',
        title: holding.reason,
        planIds: holding.planIds,
        durationMin: Math.min(minutes, FOLLOW_UP_DURATION_MAX),
        timing: customMissing ? 'no_preference' : timing,
        customDate: custom && !customMissing ? customDate : null,
        preferredDentistId: holding.dentistId,
        note,
        clinicalPrep,
        bookedAppointmentId: holding.id,
      };
    }
    if (!chosenKind) return undefined;
    return {
      kind: chosenKind,
      title,
      planIds: selected.map((proposal) => proposal.planId),
      priority: combined?.priority ?? null,
      sessionNumber: selected.length === 1 ? (firstSelected?.sessionNumber ?? null) : null,
      sessionTotal: selected.length === 1 ? (firstSelected?.sessionTotal ?? null) : null,
      durationMin,
      timing,
      customDate: custom ? customDate : null,
      preferredDentistId: dentistId,
      note,
      clinicalPrep,
    };
  };

  const pickProposal = (proposal: NextAppointmentProposal, add: boolean) => {
    const next = add
      ? selected.some((item) => item.planId === proposal.planId)
        ? selected.filter((item) => item.planId !== proposal.planId)
        : [...selected, proposal]
      : [proposal];
    setSelected(next);
    setKind(null);
    if (next.length > 0) {
      const merged = combineProposals(next);
      setDurationMin(merged.durationMin);
      setTiming(merged.timing);
    }
  };
  const pickKind = (next: FollowUpKind) => {
    setSelected([]);
    setKind(next);
    setDurationMin(FOLLOW_UP_KIND_DEFAULTS[next].durationMin);
    setTiming(FOLLOW_UP_KIND_DEFAULTS[next].timing);
  };

  const dentist = resources.data?.dentists.find((item) => item.id === dentistId);
  const canBook =
    session !== undefined &&
    canWriteAppointment(
      { permissions: session.permissions, profileId: session.profile?.id ?? null },
      { dentistId },
    );
  const dueOn = followUpDueOn(timing, visit.localDate, custom ? customDate || null : null);
  const window = followUpSearchWindow(
    { dueOn, timing, customDate: custom ? customDate : null },
    today,
  );
  const clock = { timeZone, locale: i18n.language };
  const recap = [
    title,
    t('panel.minutes', { count: durationMin }),
    t(`timings.${timing}`).toLowerCase(),
  ].join(' · ');

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !completing) onBack();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 flex max-h-[calc(100%-48px)] w-[calc(100%-48px)] max-w-[600px] -translate-x-1/2 -translate-y-1/2 animate-popin flex-col overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="flex-none border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
            <DialogSteps
              steps={[t('steps.nextAppointment'), t('steps.payment')]}
              current={0}
              className="mb-2"
            />
            <Dialog.Title className="m-0 text-[16.5px] leading-[1.2] font-semibold">
              {t('next.title')}
            </Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[12.5px] text-ink-muted">
              {patientName}
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-[22px] py-4">
            {booking ? (
              <SlotFinder
                context={{
                  patientId: visit.patientId,
                  patientName,
                  reason: title,
                  visitType: chosenKind ? FOLLOW_UP_KIND_DEFAULTS[chosenKind].visitType : null,
                  durationMin,
                  dentistId,
                  from: window.from,
                  to: window.to,
                  timingLabel: t(`timings.${timing}`),
                  planIds: selected.map((proposal) => proposal.planId),
                  sourceVisitId: visit.id,
                }}
                cancelLabel={t('next.sendToFrontDesk')}
                onCancel={() => {
                  setBooking(false);
                }}
                onBooked={(appointment) => {
                  setBooked(appointment);
                  setBooking(false);
                }}
              />
            ) : holding ? (
              <div className="rounded-lg border border-success-border bg-success-bg p-3 text-[13px]">
                <p className="m-0 font-semibold text-success">{t('next.booked')}</p>
                <p className="m-0 mt-0.5">
                  {formatCalendarDate(holding.localDate, i18n.language)} ·{' '}
                  {formatTime(holding.startsAt, clock)} · {holding.dentistName}
                  {holding.roomName ? ` · ${holding.roomName}` : ''}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {proposals.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {proposals.map((proposal) => {
                      const on = selected.some((item) => item.planId === proposal.planId);
                      return (
                        <li
                          key={proposal.planId}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-3 py-2',
                            on ? 'border-primary bg-primary-tint/40' : 'border-border',
                          )}
                        >
                          <button
                            type="button"
                            aria-pressed={on}
                            className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-start"
                            onClick={() => {
                              pickProposal(proposal, false);
                            }}
                          >
                            <span className="block text-[13px] font-medium">
                              {proposalTitle(proposal)}
                            </span>
                            <span className="block text-[11.5px] text-ink-muted">
                              {proposal.sessionNumber
                                ? proposal.sessionTotal
                                  ? t('next.session', {
                                      number: proposal.sessionNumber,
                                      total: proposal.sessionTotal,
                                    })
                                  : t('next.sessionOpen', { number: proposal.sessionNumber })
                                : t('next.pending')}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-primary hover:underline"
                            onClick={() => {
                              pickProposal(proposal, true);
                            }}
                          >
                            {on && selected.length > 1 ? t('next.remove') : t('next.add')}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="m-0 text-[13px] text-ink-secondary">{t('next.nothingOpen')}</p>
                )}
                <div role="group" aria-label={t('next.kinds')} className="flex flex-wrap gap-1">
                  {FOLLOW_UP_KINDS.filter(
                    (item) => item !== 'continue_treatment' && item !== 'planned_treatment',
                  ).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={kind === item}
                      className={chipClass(kind === item)}
                      onClick={() => {
                        pickKind(item);
                      }}
                    >
                      {t(`kinds.${item}`)}
                    </button>
                  ))}
                </div>
                {kind === 'other' ? (
                  <Field label={t('next.otherLabel')}>
                    {(field) => (
                      <TextInput
                        {...field}
                        value={otherText}
                        maxLength={200}
                        onChange={(event) => {
                          setOtherText(event.target.value);
                        }}
                      />
                    )}
                  </Field>
                ) : null}
                {hasChoice ? (
                  <>
                    <div>
                      <p className="m-0 mb-1.5 text-xs font-medium text-ink-secondary">
                        {t('next.duration')}
                      </p>
                      <div role="group" className="flex flex-wrap items-center gap-1">
                        {SLOT_LENGTHS.map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            aria-pressed={durationMin === minutes}
                            className={chipClass(durationMin === minutes)}
                            onClick={() => {
                              setDurationMin(minutes);
                            }}
                          >
                            {minutes}
                          </button>
                        ))}
                        <TextInput
                          type="number"
                          min={5}
                          max={240}
                          aria-label={t('next.customDuration')}
                          className="h-[30px] w-[76px]"
                          value={durationMin}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (value > 0) setDurationMin(Math.min(value, 240));
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="m-0 mb-1.5 text-xs font-medium text-ink-secondary">
                        {t('next.timing')}
                      </p>
                      <div role="group" className="flex flex-wrap items-center gap-1">
                        {FOLLOW_UP_TIMINGS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={timing === option}
                            className={chipClass(timing === option)}
                            onClick={() => {
                              setTiming(option);
                            }}
                          >
                            {t(`timings.${option}`)}
                          </button>
                        ))}
                        {custom ? (
                          <TextInput
                            type="date"
                            aria-label={t('timings.custom')}
                            className="h-[30px] w-auto"
                            min={today}
                            value={customDate}
                            onChange={(event) => {
                              setCustomDate(event.target.value);
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className="text-[12.5px]">
                      <span className="text-ink-secondary">{t('next.dentistNotes')}</span>{' '}
                      <span>· {dentist?.name ?? ''}</span>{' '}
                      <button
                        type="button"
                        aria-expanded={detailsOpen}
                        className="cursor-pointer border-none bg-transparent p-0 text-primary hover:underline"
                        onClick={() => {
                          setDetailsOpen(!detailsOpen);
                        }}
                      >
                        {t('next.change')}
                      </button>
                    </div>
                    {detailsOpen ? (
                      <div className="flex flex-col gap-2.5">
                        <Field label={t('next.preferredDentist')}>
                          {(field) => (
                            <Select
                              {...field}
                              value={dentistId}
                              onChange={(event) => {
                                setDentistId(event.target.value);
                              }}
                            >
                              {resources.data?.dentists.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                        <Field label={t('next.note')}>
                          {(field) => (
                            <TextInput
                              {...field}
                              value={note}
                              maxLength={500}
                              onChange={(event) => {
                                setNote(event.target.value);
                              }}
                            />
                          )}
                        </Field>
                        <Field label={t('next.clinicalPrep')}>
                          {(field) => (
                            <TextInput
                              {...field}
                              value={clinicalPrep}
                              maxLength={500}
                              onChange={(event) => {
                                setClinicalPrep(event.target.value);
                              }}
                            />
                          )}
                        </Field>
                      </div>
                    ) : null}
                    {canBook ? (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={customMissing}
                          onClick={() => {
                            setBooking(true);
                          }}
                        >
                          {t('next.bookNow')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          </div>
          {booking ? null : (
            <div className="flex flex-none flex-wrap items-center gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
              {holding ? null : (
                <Button
                  variant="secondary"
                  disabled={completing}
                  onClick={() => {
                    onComplete(undefined);
                  }}
                >
                  {t('next.skip')}
                </Button>
              )}
              {hasChoice && !holding ? (
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">{recap}</span>
              ) : (
                <span className="flex-1" />
              )}
              <Button
                variant="primary"
                disabled={completing || (!holding && (!hasChoice || customMissing))}
                onClick={() => {
                  onComplete(payload());
                }}
              >
                {holding ? t('next.complete') : t('next.completeSend')}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
