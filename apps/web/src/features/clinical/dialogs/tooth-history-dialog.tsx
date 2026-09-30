import {
  type DiagnosisRecord,
  type HistoryService,
  isPrimary,
  type PatientChart,
  predecessorOf,
  successorOf,
  type ToothCode,
  type TreatmentPlan,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { shownTooth } from '../chart/shown-tooth';
import { ToothGlyph } from '../chart/tooth-glyph';
import {
  useChartSettings,
  useSurfaceLabel,
  useToothLabel,
  useToothName,
} from '../chart/use-chart-settings';
import { StartVisitPopover } from '../start-visit-popover';
import { chartQuery, toothHistoryQuery } from '../visits-api';
import { Badge } from '../workspace/tooth-panel/panel-section';
import { SurfaceTag } from '../workspace/tooth-panel/surface-tag';

const MICRO =
  'm-0 text-[11.5px] leading-none font-medium tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal';

export interface ToothHistoryDialogProps {
  patientId: string;
  /** Shown after the tooth's name; absent while the patient loads. */
  patientName: string | undefined;
  /** The tooth shown; `null` closes the dialog. */
  code: ToothCode | null;
  /** The succession link switches the tooth; closing sets `null`. */
  onCodeChange: (code: ToothCode | null) => void;
  /** Whether the empty state may offer **Start a visit** (not on an archived record). */
  canStart: boolean;
  /** Inside the visit workspace: "Chart it in this visit" selects the tooth there (the dialog
   * closes itself). Elsewhere it goes to the patient's most recently started live visit (the
   * chart's) with the tooth selected. */
  onChartIt?: ((code: ToothCode) => void) | undefined;
}

/**
 * The Tooth History modal (spec §Tooth History modal): a 15 px read-only glyph in the tooth's
 * current state, "Tooth #16", its anatomical name and the patient, and the succession link — a
 * primary tooth's permanent successor, or a permanent tooth's primary predecessor (in a child's
 * dentition, or when it has records), which switches the dialog to that tooth. The body holds the
 * three stages in order: diagnoses (Active / Resolved), treatment plans (Planned / Performed /
 * Cancelled, with the price) and the completed services as a timeline. A tooth with none of them
 * offers **Chart it in this visit** while a visit is live for the patient (to the workspace, with
 * the tooth selected; only for the tooth the chart shows in its position) or **Start a visit**
 * (the start popover); both need `visit:write`. A modal:
 * focus is trapped, `Esc` closes it and focus goes back to what opened it.
 */
export function ToothHistoryDialog({
  patientId,
  patientName,
  code,
  onCodeChange,
  canStart,
  onChartIt,
}: ToothHistoryDialogProps) {
  // Radix only hands focus back to a `Dialog.Trigger`, and this dialog is opened by code.
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={code !== null}
      onOpenChange={(open) => {
        if (!open) onCodeChange(null);
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
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[516px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2"
        >
          {code !== null && (
            <HistoryContent
              patientId={patientId}
              patientName={patientName}
              code={code}
              onCodeChange={onCodeChange}
              canStart={canStart}
              onChartIt={onChartIt}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HistoryContent({
  patientId,
  patientName,
  code,
  onCodeChange,
  canStart,
  onChartIt,
}: ToothHistoryDialogProps & { code: ToothCode }) {
  const { t } = useTranslation(['clinical', 'common']);
  const { mode, orientation } = useChartSettings();
  const label = useToothLabel();
  const name = useToothName();
  const chart = useQuery(chartQuery(patientId));
  const history = useQuery(toothHistoryQuery(patientId, code));
  const succession = chart.data ? successionOf(code, chart.data) : null;

  return (
    <>
      <div className="flex items-start gap-3.5 border-b border-inner-divider px-5 pt-[18px] pb-4">
        <ToothGlyph
          variant="history"
          code={code}
          tooth={chart.data?.teeth.find((tooth) => tooth.code === code)}
          mode={mode}
          orientation={orientation}
        />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="m-0 mb-[3px] text-[17px] leading-[1.2] font-semibold tracking-[-0.01em]">
            {t('history.title', { label: label(code) })}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] leading-[1.4] text-ink-tertiary">
              <span>
                {patientName === undefined
                  ? name(code)
                  : t('history.subtitle', { name: name(code), patient: patientName })}
              </span>
              {isPrimary(code) && <Badge tone="neutral">{t('panel.primary')}</Badge>}
            </div>
          </Dialog.Description>
          {succession && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] leading-[1.4] text-ink-secondary">
              <span>
                {t(
                  succession.kind === 'successor'
                    ? 'succession.successor'
                    : 'succession.predecessor',
                )}
              </span>
              <button
                type="button"
                dir="ltr"
                onClick={() => {
                  onCodeChange(succession.target);
                }}
                className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[12.5px] leading-none font-semibold text-primary hover:underline"
              >
                {label(succession.target)}
              </button>
            </div>
          )}
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            aria-label={t('common:close')}
            className="grid size-7 flex-none cursor-pointer place-items-center rounded-md border border-border bg-faint hover:border-border-strong"
          >
            <svg
              aria-hidden
              width="11"
              height="11"
              viewBox="0 0 12 12"
              className="stroke-ink-tertiary"
              strokeWidth="1.7"
            >
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </Dialog.Close>
      </div>
      <div className="max-h-[52vh] overflow-auto px-5 pt-4 pb-5">
        {history.data ? (
          <Stages
            diagnoses={history.data.diagnoses}
            plans={history.data.plans}
            services={history.data.services}
            empty={
              <EmptyHistory
                patientId={patientId}
                code={code}
                chart={chart.data}
                chartFailed={chart.isError}
                canStart={canStart}
                onChartIt={onChartIt}
                onLeave={() => {
                  onCodeChange(null);
                }}
              />
            }
          />
        ) : history.isError ? (
          <p
            role="alert"
            className="m-0 py-6 text-center text-[12.5px] leading-snug text-ink-muted"
          >
            {t('history.failed')}
          </p>
        ) : (
          <CardSkeleton label={t('history.loading')} />
        )}
      </div>
    </>
  );
}

/** The other tooth of this position: a primary tooth's successor always; a permanent tooth's
 * predecessor in a primary or mixed dentition, or when the predecessor has records (the tooth
 * panel's succession row, W5). */
function successionOf(
  code: ToothCode,
  chart: PatientChart,
): { kind: 'successor' | 'predecessor'; target: ToothCode } | null {
  if (isPrimary(code)) return { kind: 'successor', target: successorOf(code) };
  const predecessor = predecessorOf(code);
  if (predecessor === null) return null;
  const hasRecords = chart.teeth.some((tooth) => tooth.code === predecessor);
  if (chart.dentition.stage === 'permanent' && !hasRecords) return null;
  return { kind: 'predecessor', target: predecessor };
}

function Stages({
  diagnoses,
  plans,
  services,
  empty,
}: {
  diagnoses: readonly DiagnosisRecord[];
  plans: readonly TreatmentPlan[];
  services: readonly HistoryService[];
  empty: ReactNode;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const timeZone = useSession().data?.tenant?.timeZone ?? 'UTC';
  const { mode } = useChartSettings();
  const surfaceLabel = useSurfaceLabel();

  if (diagnoses.length + plans.length + services.length === 0) return empty;

  return (
    <>
      {diagnoses.length > 0 && (
        <Stage title={t('history.diagnosis')} tone="text-danger">
          {diagnoses.map((record) => (
            <li
              key={record.id}
              className="mb-[7px] rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <div className="mb-1 flex items-baseline gap-[9px]">
                <span className="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold">
                  {record.name}
                </span>
                <SurfaceTag surfaces={record.surfaces} className="text-danger" />
                <Badge tone={record.status === 'active' ? 'danger' : 'success'}>
                  {t(record.status === 'active' ? 'history.active' : 'history.resolved')}
                </Badge>
                <span className="flex-none font-mono text-[12.5px] leading-[1.4] text-ink-muted">
                  {formatCalendarDate(record.recordedInVisitDate, locale)}
                </span>
              </div>
              <div className="text-[12.5px] leading-normal text-ink-secondary">
                {record.note ?? record.dentistName}
              </div>
            </li>
          ))}
        </Stage>
      )}
      {plans.length > 0 && (
        <Stage title={t('history.plan')} tone="text-warning">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className="mb-[7px] flex items-baseline gap-[9px] rounded-lg border border-planned-border bg-planned-bg px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold">
                {plan.name}
              </span>
              <SurfaceTag surfaces={plan.surfaces} className="text-warning" />
              <Badge
                tone={
                  plan.status === 'planned'
                    ? 'warning'
                    : plan.status === 'performed'
                      ? 'success'
                      : 'neutral'
                }
              >
                {t(`history.${plan.status}`)}
              </Badge>
              <span className="flex-none font-mono text-[12.5px] leading-[1.4] text-ink-muted">
                {formatDate(plan.recordedAt, { timeZone, locale })}
              </span>
              <span
                dir="ltr"
                className="flex-none font-mono text-[13px] leading-none font-semibold tabular-nums"
              >
                {formatMoney(plan.price, locale)}
              </span>
            </li>
          ))}
        </Stage>
      )}
      {services.length > 0 && (
        <Stage title={t('history.completed')} tone="text-primary" last>
          {services.map((line) => {
            const surfaces =
              mode === 'surface' && line.surfaces.length > 0
                ? line.surfaces.map(surfaceLabel.name).join(t('title.listSeparator'))
                : null;
            return (
              <li key={line.id} className="grid grid-cols-[14px_1fr] gap-3.5">
                <div aria-hidden className="flex flex-col items-center pt-[5px]">
                  <span className="mb-1 size-[9px] flex-none rounded-full bg-primary" />
                  <span className="w-px flex-1 bg-border" />
                </div>
                <div className="min-w-0 pb-[18px]">
                  <div className="mb-[5px] font-mono text-[11.5px] leading-none font-medium text-ink-muted">
                    {formatCalendarDate(line.visitDate, locale)}
                  </div>
                  <div className="mb-[5px] flex flex-wrap items-baseline gap-[9px]">
                    <span className="text-[14px] leading-[1.2] font-semibold">{line.name}</span>
                    <span
                      dir="ltr"
                      className="font-mono text-[13px] leading-none font-medium text-ink-secondary tabular-nums"
                    >
                      {formatMoney(line.final, locale)}
                    </span>
                    <Badge tone="success">{t('history.done')}</Badge>
                  </div>
                  <div className="text-[12.5px] leading-normal text-ink-tertiary">
                    {surfaces === null
                      ? line.dentistName
                      : [line.dentistName, surfaces].join(' · ')}
                  </div>
                </div>
              </li>
            );
          })}
        </Stage>
      )}
    </>
  );
}

/** One stage: its micro label in the stage colour, then its records as a list. */
function Stage({
  title,
  tone,
  last = false,
  children,
}: {
  title: string;
  tone: string;
  last?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cn(!last && 'mb-[18px]')}>
      <h3 id={titleId} className={cn(MICRO, 'mb-[9px]', tone)}>
        {title}
      </h3>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

/**
 * Nothing recorded on the tooth (`visit:write` only): chart it in the live visit — when it is the
 * tooth the chart shows in its position; otherwise a note names the one it shows — else start a
 * visit. Without the chart (a failed read) there is no knowing which, and the note says so.
 */
function EmptyHistory({
  patientId,
  code,
  chart,
  chartFailed,
  canStart,
  onChartIt,
  onLeave,
}: {
  patientId: string;
  code: ToothCode;
  /** `undefined` while the chart loads, or when it failed. */
  chart: PatientChart | undefined;
  chartFailed: boolean;
  canStart: boolean;
  onChartIt: ((code: ToothCode) => void) | undefined;
  /** Closes the dialog. */
  onLeave: () => void;
}) {
  const { t } = useTranslation('clinical');
  const canWrite = usePermission('visit:write');
  const label = useToothLabel();
  const navigate = useNavigate();

  let action: ReactNode = null;
  let note: string | null = null;
  const liveVisitId = chart?.liveVisitId ?? null;
  if (canWrite && chartFailed) {
    note = t('history.chartFailed');
  } else if (canWrite && chart && (onChartIt || liveVisitId)) {
    const shown = shownTooth(code, chart.dentition.stage, chart.toothStatus);
    if (shown !== code) {
      note = t('history.notShown', { label: label(shown) });
    } else {
      action = (
        <Button
          variant="primary"
          onClick={() => {
            onLeave();
            if (onChartIt) {
              onChartIt(code);
            } else if (liveVisitId) {
              void navigate({
                to: '/visits/$visitId',
                params: { visitId: liveVisitId },
                search: { tooth: code },
              });
            }
          }}
        >
          {t('history.chartIt')}
        </Button>
      );
    }
  } else if (canWrite && chart && canStart) {
    action = (
      <StartVisitPopover patientId={patientId}>
        <Button variant="primary">{t('history.startVisit')}</Button>
      </StartVisitPopover>
    );
  }

  return (
    <div className="px-5 py-9 text-center">
      <h3 className="m-0 mb-[5px] text-[14px] leading-[1.3] font-semibold">
        {t('history.emptyTitle')}
      </h3>
      <p className={cn('m-0 text-[12.5px] leading-normal text-ink-muted', action && 'mb-4')}>
        {t('history.emptyBody')}
      </p>
      {note !== null && (
        <p className="m-0 mt-3 text-[12.5px] leading-normal text-ink-secondary">{note}</p>
      )}
      {action}
    </div>
  );
}
