import { toCents, type PatientChart, type Visit } from '@dcm/contracts';
import { useMutation } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useStaffNames } from '@/features/users/use-staff-names';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useChartSettings,
  useLevelLabel,
  useSurfaceLabel,
  useToothLabel,
} from '../chart/use-chart-settings';
import { useFlushSaveGroups, useLocalValues } from '../save-groups-context';
import { useVisitTimer } from '../use-visit-timer';
import { useVisitMutations, useVisitMutationsSettled } from '../visit-mutations';
import { servicePriceKey } from '../workspace/charting-actions';
import { DiscountControl } from '../workspace/discount-control';
import { NOTES_KEY } from '../workspace/notes-card';
import { plansTotal } from '../workspace/tooth-panel/tooth-records';
import { unfinishedWork } from '../workspace/unfinished';
import { type PriceDraft, priceDraftOf, priceOf } from '../workspace/tooth-panel/service-price';
import { useLiveMoney, useVisitDiscount } from '../workspace/visit-discount';

const MICRO =
  'm-0 text-[11.5px] leading-none font-medium tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal';
const FIGURE = 'font-mono leading-none tabular-nums';

export interface VisitSummaryDialogProps {
  visit: Visit;
  /** The patient's chart, for "Recorded for later"; absent while it loads. */
  chart: PatientChart | undefined;
  open: boolean;
  /** Continue editing, `Esc` or the scrim; never while the visit is being recorded. */
  onClose: () => void;
}

/**
 * The Visit Summary modal (spec §Visit Summary (Complete Visit) modal), opened by **Review &
 * complete**: the meta tiles (the duration is the running timer, W19), the teeth treated in FDI
 * order, the services with their targets and final prices, the editable financial block — the
 * footer's own `discount` save group, so the two are live in both directions (V7) — "Recorded for
 * later" (the diagnoses and open plans recorded in this visit, with the plan estimate) and the
 * clinical notes. Opening it doesn't stop the timer.
 *
 * **Complete visit** first sends every unsaved edit (V6); if any fails, the visit is not completed
 * on stale values and the dialog says so. It then waits for the visit's writes still in flight (a
 * Perform now, a removal), so the visit it freezes has them. Then `POST /visits/:id/complete`
 * ("Recording…": the timer shown stops and the discount turns read-only): the
 * cached visit turns `completed` and the workspace page leaves for the record's Overview with the
 * post-visit summary (W16) — the page navigates, never this dialog, so there is one navigation.
 * A modal: focus is trapped, `Esc` closes it and focus goes back to what opened it.
 */
export function VisitSummaryDialog({ visit, chart, open, onClose }: VisitSummaryDialogProps) {
  const [recording, setRecording] = useState(false);
  // Radix only hands focus back to a `Dialog.Trigger`, and this dialog is opened by code.
  const returnFocus = useRef<HTMLElement | null>(null);
  const holdWhileRecording = (event: Event) => {
    if (recording) event.preventDefault();
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !recording) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            const opener = document.activeElement;
            returnFocus.current = opener instanceof HTMLElement ? opener : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = returnFocus.current;
            returnFocus.current = null;
            if (opener?.isConnected) opener.focus();
          }}
          onEscapeKeyDown={holdWhileRecording}
          onInteractOutside={holdWhileRecording}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[604px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2"
        >
          <SummaryContent
            visit={visit}
            chart={chart}
            recording={recording}
            onRecording={setRecording}
            onClose={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SummaryContent({
  visit,
  chart,
  recording,
  onRecording,
  onClose,
}: Omit<VisitSummaryDialogProps, 'open'> & {
  recording: boolean;
  onRecording: (recording: boolean) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const timer = useVisitTimer(visit.id);
  const { dentistNames } = useStaffNames();
  const flush = useFlushSaveGroups();
  const settled = useVisitMutationsSettled(visit.id);
  const complete = useMutation(useVisitMutations(visit.id).complete);
  const [error, setError] = useState<string | null>(null);
  const [notes] = useLocalValues<string>([NOTES_KEY]);
  const text = notes ?? visit.notes;
  // The duration as it stood on Complete: what is recorded, so it no longer ticks.
  const [frozenTimer, setFrozenTimer] = useState<string | null>(null);
  const shownTimer = frozenTimer ?? timer;

  const onComplete = async () => {
    setError(null);
    onRecording(true);
    setFrozenTimer(timer);
    const stop = (message: string) => {
      setError(message);
      setFrozenTimer(null);
      onRecording(false);
    };
    if (!(await flush())) {
      stop(t('summary.unsaved'));
      return;
    }
    await settled();
    try {
      await complete.mutateAsync();
    } catch (failure) {
      stop(t('summary.failed', { reason: failure instanceof Error ? failure.message : '' }));
    }
    // Completed: the page, which reads the cached visit, leaves for the record (W16).
  };

  return (
    <>
      <div className="border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
        <Dialog.Title className="m-0 mb-[3px] text-[16.5px] leading-[1.2] font-semibold tracking-[-0.01em]">
          {t('summary.title')}
        </Dialog.Title>
        <Dialog.Description className="sr-only">{t('summary.subtitle')}</Dialog.Description>
      </div>
      <div className="max-h-[56vh] overflow-auto px-[22px] py-[18px]">
        <dl className="m-0 mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Tile label={t('summary.date')}>
            <span className="text-[13px] leading-none font-medium">
              {formatCalendarDate(visit.localDate, locale)}
            </span>
          </Tile>
          <Tile label={t('summary.dentist')}>
            <span className="text-[13px] leading-none font-medium">
              {dentistNames.get(visit.dentistId) ?? '—'}
            </span>
          </Tile>
          <Tile label={t('summary.duration')}>
            <span dir="ltr" className={cn(FIGURE, 'text-[14px] font-semibold')}>
              {shownTimer}
            </span>
          </Tile>
        </dl>
        <TeethTreated visit={visit} />
        <Services visit={visit} />
        <FinancialBlock visit={visit} readOnly={recording} />
        {chart && <UnfinishedToday visit={visit} chart={chart} />}
        {chart && <RecordedForLater visit={visit} chart={chart} />}
        <h3 className={cn(MICRO, 'mb-2 text-ink-muted')}>{t('summary.notes')}</h3>
        <p
          className={cn(
            'm-0 rounded-lg border border-inner-divider bg-sunken px-3.5 py-3 text-[12.5px] leading-[1.6] whitespace-pre-wrap',
            text.trim() === '' ? 'text-ink-muted' : 'text-ink-secondary',
          )}
        >
          {text.trim() === '' ? t('summary.noNotes') : text}
        </p>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="m-0 border-t border-danger-border bg-danger-bg px-[22px] py-2.5 text-[12.5px] leading-snug font-medium text-danger"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
        <Button
          variant="secondary"
          disabled={recording}
          onClick={onClose}
          className="h-[38px] text-[13px]"
        >
          {t('summary.continue')}
        </Button>
        <span className="ms-auto text-[12.5px] leading-none text-ink-muted">
          {t('summary.timerStops', { time: shownTimer })}
        </span>
        <Button
          variant="primary"
          disabled={recording}
          onClick={() => {
            void onComplete();
          }}
          className="h-[38px] px-[17px] text-[13px] font-semibold disabled:cursor-wait disabled:opacity-80"
        >
          {recording ? t('summary.recording') : t('summary.complete')}
        </Button>
      </div>
    </>
  );
}

/** One meta tile: a micro label over its value. */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-inner-divider bg-faint px-[13px] py-[11px]">
      <dt className={cn(MICRO, 'mb-1.5 text-ink-muted')}>{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

/** The teeth this visit's services touch, in FDI code order, as the clinic labels them. */
function TeethTreated({ visit }: { visit: Visit }) {
  const { t } = useTranslation('clinical');
  const label = useToothLabel();
  const titleId = useId();
  const teeth = [...new Set(visit.services.flatMap((service) => service.toothCode ?? []))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return (
    <section aria-labelledby={titleId} className="mb-[18px]">
      <h3 id={titleId} className={cn(MICRO, 'mb-[9px] text-ink-muted')}>
        {t('summary.teeth')}
      </h3>
      {teeth.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-[7px] p-0">
          {teeth.map((code) => (
            <li
              key={code}
              dir="ltr"
              className="rounded-md border border-primary-tint-border bg-primary-tint px-2.5 py-[5px] font-mono text-[12.5px] leading-none font-semibold text-primary"
            >
              {label(code)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[12.5px] leading-none text-ink-muted">{t('summary.noTeeth')}</p>
      )}
    </section>
  );
}

/** Each service with its target (`#16 · O · D`, or its jaw or "Whole mouth") and its final price as it stands now:
 * a price still being typed in the tooth panel counts (its `service:<id>` group). */
function Services({ visit }: { visit: Visit }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { mode } = useChartSettings();
  const label = useToothLabel();
  const levelLabel = useLevelLabel();
  const surfaceLabel = useSurfaceLabel();
  const titleId = useId();
  const typed = useLocalValues<PriceDraft>(
    visit.services.map((service) => servicePriceKey(service.id)),
  );
  return (
    <section aria-labelledby={titleId} className="mb-[18px]">
      <h3 id={titleId} className={cn(MICRO, 'mb-2 text-ink-muted')}>
        {t('summary.services')}
      </h3>
      {visit.services.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {visit.services.map((service, index) => {
            const target =
              service.toothCode === null
                ? levelLabel(service.jaw)
                : [
                    label(service.toothCode),
                    ...(mode === 'surface' && service.surfaces.length > 0
                      ? [surfaceLabel.format(service.surfaces)]
                      : []),
                  ].join(' · ');
            const final = priceOf(typed[index] ?? priceDraftOf(service)).final;
            return (
              <li
                key={service.id}
                className="grid grid-cols-[minmax(0,1fr)_126px_88px] items-baseline border-b border-row-divider py-[9px]"
              >
                <span className="pe-2 text-[13px] leading-[1.3]">{service.name}</span>
                <span className="px-2 text-[12.5px] leading-[1.3] text-ink-muted">
                  <bdi>{target}</bdi>
                </span>
                <span dir="ltr" className={cn(FIGURE, 'ps-2 text-end text-[13px] font-medium')}>
                  {formatMoney({ amount: final, currency: visit.currency }, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-[12.5px] leading-none text-ink-muted">{t('summary.noServices')}</p>
      )}
    </section>
  );
}

/** Subtotal, the visit discount (the footer's control and group; read-only while recording), the
 * cap warning and Total due: `useLiveMoney`, the server's arithmetic over what is typed now. */
function FinancialBlock({ visit, readOnly }: { visit: Visit; readOnly: boolean }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const discount = useVisitDiscount(visit);
  const money = useLiveMoney(visit, discount.value);
  const format = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const discounted = toCents(money.discount) > 0n;
  const labelId = useId();
  return (
    <div className="mb-[18px] rounded-[9px] border border-inner-divider bg-faint px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3 py-1">
        <span className="text-[12.5px] leading-none text-ink-secondary">
          {t('summary.subtotal')}
        </span>
        <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] font-medium')}>
          {format(money.subtotal)}
        </span>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center justify-between gap-3 py-[9px]"
      >
        <span id={labelId} className="text-[12.5px] leading-none text-ink-secondary">
          {t('summary.discount')}
        </span>
        <span className="flex items-center gap-[7px]">
          <DiscountControl discount={discount} currency={visit.currency} readOnly={readOnly} />
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'w-[66px] text-end text-[12.5px] font-medium',
              discounted ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {format(discounted ? `-${money.discount}` : money.discount)}
          </span>
        </span>
      </div>
      {money.capped && (
        <p
          role="alert"
          className="m-0 mb-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-[12.5px] leading-[1.4] font-medium text-danger"
        >
          {t('money.capped')}
        </p>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-divider-strong pt-2.5">
        <span className="text-[13px] leading-none font-semibold">{t('summary.totalDue')}</span>
        <span dir="ltr" className={cn(FIGURE, 'text-[18px] font-bold tracking-[-0.02em]')}>
          {format(money.total)}
        </span>
      </div>
    </div>
  );
}

/** The services this visit worked on without finishing them (ADR-0032): they continue in a later
 * visit and are charged by the one that completes them. Nothing when there is none. */
function UnfinishedToday({ visit, chart }: { visit: Visit; chart: PatientChart }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const label = useToothLabel();
  const levelLabel = useLevelLabel();
  const titleId = useId();
  const { workedHere } = unfinishedWork(chart.plans, visit.id);
  if (workedHere.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="mb-[18px] rounded-[9px] border border-warning-border bg-warning-bg px-4 py-3.5"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline gap-[9px]">
        <h3 id={titleId} className={cn(MICRO, 'text-warning')}>
          {t('summary.unfinished')}
        </h3>
        <span className="ms-auto text-[12.5px] leading-none text-warning">
          {t('summary.notBilled')}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {workedHere.map((plan) => (
          <li key={plan.id} className="flex items-baseline gap-[9px] py-[5px]">
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35]">
              {t('summary.session', { name: plan.name, number: plan.sessions.length })}
            </span>
            <span
              dir="ltr"
              className="font-mono text-[12.5px] leading-none font-medium text-ink-secondary"
            >
              {plan.toothCode === null ? levelLabel(plan.jaw) : label(plan.toothCode)}
            </span>
            <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] text-ink-muted')}>
              {formatMoney(plan.price, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The diagnoses and the plans this visit recorded (the standing record once it completes), with
 * the plan estimate; nothing when there is none. */
function RecordedForLater({ visit, chart }: { visit: Visit; chart: PatientChart }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const label = useToothLabel();
  const levelLabel = useLevelLabel();
  const titleId = useId();
  const diagnoses = chart.diagnoses.filter((record) => record.recordedInVisitId === visit.id);
  const plans = chart.plans.filter(
    (plan) => plan.recordedInVisitId === visit.id && plan.status === 'planned',
  );
  const estimate = plansTotal(plans);
  if (diagnoses.length + plans.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="mb-[18px] rounded-[9px] border border-planned-border bg-planned-bg px-4 py-3.5"
    >
      <div className="mb-2.5 flex flex-wrap items-baseline gap-[9px]">
        <h3 id={titleId} className={cn(MICRO, 'text-warning')}>
          {t('summary.later')}
        </h3>
        <span className="ms-auto text-[12.5px] leading-none text-warning">
          {t('summary.notBilled')}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {diagnoses.map((record) => (
          <li key={record.id} className="flex items-baseline gap-[9px] py-[5px]">
            <span aria-hidden className="size-1.5 flex-none rounded-full bg-danger" />
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35]">
              {t('summary.diagnosis', { name: record.name })}
            </span>
            <span
              dir="ltr"
              className="font-mono text-[12.5px] leading-none font-medium text-ink-secondary"
            >
              {label(record.toothCode)}
            </span>
          </li>
        ))}
        {plans.map((plan) => (
          <li key={plan.id} className="flex items-baseline gap-[9px] py-[5px]">
            <span aria-hidden className="size-1.5 flex-none rounded-full bg-planned-border" />
            <span className="min-w-0 flex-1 text-[12.5px] leading-[1.35]">
              {t('summary.planned', { name: plan.name })}
            </span>
            <span
              dir="ltr"
              className="font-mono text-[12.5px] leading-none font-medium text-ink-secondary"
            >
              {plan.toothCode === null ? levelLabel(plan.jaw) : label(plan.toothCode)}
            </span>
            <span dir="ltr" className={cn(FIGURE, 'w-16 text-end text-[12.5px] font-medium')}>
              {formatMoney(plan.price, locale)}
            </span>
          </li>
        ))}
      </ul>
      {estimate && (
        <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-warning-border pt-[9px]">
          <span className="text-[12.5px] leading-none font-semibold text-warning">
            {t('summary.estimate')}
          </span>
          <span dir="ltr" className={cn(FIGURE, 'text-[14px] font-semibold text-warning')}>
            {formatMoney(estimate, locale)}
          </span>
        </div>
      )}
    </section>
  );
}
