import {
  formatVisitNumber,
  fromCents,
  toCents,
  type VisitBalance,
  type VisitListItem,
} from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { useRecordPayment } from '@/features/billing/payments/payment-dialog-context';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useToothLabel, useSurfaceLabel } from '../chart/use-chart-settings';
import {
  amendInput,
  type AmendDraft,
  draftOf,
  draftTotal,
  isDirty,
  problemOf,
} from './amend-draft';
import { AmendForm } from './amend-form';
import { VisitAuditTrail } from './visit-audit-trail';
import { useCorrectionAccess } from './use-correction-access';
import { amendVisit, invalidateVisitData, voidVisit } from './visits-list-api';
import { VisitStatusPill } from './visits-table';

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'danger' | 'success' | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px] leading-[1.6]">
      <span className={cn(strong ? 'font-semibold' : 'text-ink-secondary')}>{label}</span>
      <span
        className={cn(
          'font-mono',
          strong && 'text-[14px] font-semibold',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The visit detail panel (spec §Detail panel, 452px, pushes the list): header, a voided banner,
 * services with tooth labels, totals with paid and balance from `billing`, the audit trail
 * (`audit:read`), and the actions by role — Void and Amend, "Request a change", Open in record.
 * Amend turns the body into the amend form; Save asks for a reason and shows before → after.
 */
export function VisitDetailPanel({
  visit,
  balance,
  canPay,
  timeZone,
  locale,
  onClose,
}: {
  visit: VisitListItem;
  balance: VisitBalance | undefined;
  canPay: boolean;
  timeZone: string;
  locale: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['visits', 'common', 'billing']);
  const navigate = useNavigate();
  const openPayment = useRecordPayment();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const access = useCorrectionAccess();
  const canAudit = usePermission('audit:read');
  const { names } = useStaffNames();
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const [draft, setDraft] = useState<AmendDraft | null>(null);
  const [badTeeth, setBadTeeth] = useState<ReadonlySet<string>>(new Set());

  const number = formatVisitNumber(visit.displayNumber);
  const money = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const correctable = visit.status === 'completed' || visit.status === 'amended';
  const voided = visit.status === 'voided';
  const dirty = draft !== null && isDirty(draft, visit);
  const paid = balance?.paid ?? '0.00';
  const outstanding = balance?.outstanding ?? (voided ? '0.00' : visit.total);

  const leaveAmend = (then: () => void) => {
    if (!dirty) {
      setDraft(null);
      then();
      return;
    }
    confirm({
      title: t('common:discardTitle'),
      body: t('common:discardBody'),
      okLabel: t('common:discard'),
      cancelLabel: t('common:keepEditing'),
      tone: 'warn',
      onConfirm: () => {
        setDraft(null);
        then();
      },
    });
  };

  const fail = (error: unknown): never => {
    void invalidateVisitData(queryClient);
    throw new Error(apiErrorMessage(error, i18n));
  };

  const saveAmendment = () => {
    if (!draft) return;
    const after = draftTotal(draft, visit);
    const delta = toCents(after) - toCents(visit.total);
    const effect =
      delta < 0n
        ? t('amend.credit', { amount: money(fromCents(-delta)) })
        : delta > 0n
          ? t('amend.charge', { amount: money(fromCents(delta)) })
          : t('amend.sameTotal');
    confirm({
      title: t('amend.confirmTitle', { number }),
      body: t('amend.confirmBody', { before: money(visit.total), after: money(after), effect }),
      okLabel: t('amend.save'),
      reasonLabel: t('amend.reason'),
      onConfirm: async (reason) => {
        try {
          await amendVisit(visit.id, amendInput(draft, visit, reason));
        } catch (error) {
          fail(error);
        }
        await invalidateVisitData(queryClient);
        setDraft(null);
        toast(t('amend.done', { number }), { tone: 'success' });
      },
    });
  };

  const startVoid = () => {
    if (toCents(balance?.paidByPayments ?? '0') > 0n) {
      // Refunds are made from the patient's payments (B7): the dialog takes you there. Write-offs
      // don't block a void (P8).
      confirm({
        title: t('void.refundTitle'),
        body: t('void.refundBody', { number, amount: money(balance?.paidByPayments ?? '0') }),
        okLabel: t('void.refundOk'),
        tone: 'warn',
        onConfirm: () => {
          void navigate({
            to: '/payments',
            search: { tab: 'transactions', range: 'all', q: number },
          });
        },
      });
      return;
    }
    confirm({
      title: t('void.title', { number }),
      body: t('void.body', { amount: money(balance?.charged ?? visit.total) }),
      okLabel: t('void.ok'),
      tone: 'danger',
      reasonLabel: t('void.reason'),
      onConfirm: async (reason) => {
        try {
          await voidVisit(visit.id, { expectedUpdatedAt: visit.updatedAt, reason });
        } catch (error) {
          fail(error);
        }
        await invalidateVisitData(queryClient);
        toast(t('void.done', { number }), { tone: 'success' });
      },
    });
  };

  const problem = draft ? problemOf(draft) : null;
  // A removed line's tooth no longer matters, whatever its field holds.
  const badTooth = draft?.lines.some((line) => !line.removed && badTeeth.has(line.id)) ?? false;
  const footer = draft ? (
    <>
      <span className="me-auto text-[12px] leading-snug text-danger">
        {badTooth ? t('amend.problem.tooth') : problem && t(`amend.problem.${problem}`)}
      </span>
      <Button
        variant="secondary"
        onClick={() => {
          leaveAmend(() => undefined);
        }}
      >
        {t('common:cancel')}
      </Button>
      <Button
        variant="primary"
        disabled={!dirty || problem !== null || badTooth}
        onClick={saveAmendment}
      >
        {t('amend.save')}
      </Button>
    </>
  ) : (
    <>
      <Link
        to="/patients/$patientId"
        params={{ patientId: visit.patient.id }}
        search={{ tab: 'history', visitId: visit.id }}
        className="me-auto text-[12.5px] font-medium text-primary hover:underline"
      >
        {t('panel.openRecord')}
      </Link>
      {correctable && access.void && (
        <Button variant="danger" onClick={startVoid}>
          {t('panel.void')}
        </Button>
      )}
      {correctable && access.amend && (
        <Button
          variant="primary"
          onClick={() => {
            setBadTeeth(new Set());
            setDraft(draftOf(visit));
          }}
        >
          {t('panel.amend')}
        </Button>
      )}
    </>
  );

  return (
    <RightPanel
      eyebrow={t('panel.eyebrow')}
      title={visit.patient.fullName}
      subtitle={
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12.5px] font-medium text-primary" dir="ltr">
              {number}
            </span>
            <VisitStatusPill status={visit.status} />
            {draft && (
              <span className="rounded-[5px] border border-warning-border bg-warning-bg px-2 text-[11.5px] leading-5 font-medium text-warning">
                {t('amend.badge')}
              </span>
            )}
          </div>
          <span className="text-[12.5px] text-ink-secondary">
            {[
              formatDate(visit.startedAt, { timeZone, locale }),
              visit.dentist.name,
              visit.room?.name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      }
      dirty={dirty}
      onClose={() => {
        leaveAmend(onClose);
      }}
      className="w-[452px] max-w-[50%]"
      footer={footer}
    >
      {voided && (
        <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">
          {t('panel.voidedBanner', { reason: visit.voidReason ?? '' })}
        </p>
      )}
      {draft ? (
        <AmendForm
          visit={visit}
          draft={draft}
          locale={locale}
          onChange={setDraft}
          onInvalidTeeth={setBadTeeth}
        />
      ) : (
        <section className="flex flex-col">
          <h3 className="mb-1 text-[13px] leading-none font-semibold">{t('panel.services')}</h3>
          <ul className="m-0 list-none p-0">
            {visit.services.map((service) => (
              <li
                key={service.id}
                className="flex items-baseline gap-2 border-t border-inner-divider py-2 text-[12.5px] first:border-t-0"
              >
                <span className="min-w-0 flex-1">{service.name}</span>
                <span className="font-mono text-ink-muted" dir="ltr">
                  {service.toothCode === null
                    ? t('panel.jaw')
                    : [toothLabel(service.toothCode), surfaceLabel.format(service.surfaces)]
                        .filter(Boolean)
                        .join(' ')}
                </span>
                <span className="w-20 text-end font-mono">
                  {formatMoney(service.final, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col border-t border-inner-divider pt-3">
        <Row label={t('panel.subtotal')} value={money(visit.subtotal)} />
        {Number(visit.discountAmount) > 0 && (
          <Row label={t('panel.discount')} value={`−${money(visit.discountAmount)}`} />
        )}
        <Row
          label={t('panel.total')}
          value={
            draft
              ? `${money(visit.total)} → ${money(draftTotal(draft, visit))}`
              : money(visit.total)
          }
          strong
        />
        {canPay && !draft && (
          <>
            <Row label={t('panel.paid')} value={money(paid)} tone="success" />
            <Row
              label={t('panel.balance')}
              value={money(outstanding)}
              tone={Number(outstanding) > 0 ? 'danger' : undefined}
            />
          </>
        )}
        {!draft && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {openPayment && correctable && Number(outstanding) > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  openPayment({ patientId: visit.patient.id, contextVisitId: visit.id });
                }}
              >
                {t('billing:balance.record')}
              </Button>
            )}
            {canPay && visit.status !== 'in_progress' && visit.status !== 'paused' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  openPrintable(printPath.invoice(visit.id));
                }}
              >
                {t('panel.invoice')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                openPrintable(printPath.quote(visit.patient.id));
              }}
            >
              {t('panel.planQuote')}
            </Button>
          </div>
        )}
      </section>
      {!draft && correctable && access.request && (
        <p className="text-[12.5px] leading-snug text-ink-secondary">
          {t('panel.requestNote')}{' '}
          <button
            type="button"
            className="cursor-pointer font-medium text-primary hover:underline"
            onClick={() => {
              toast(t('panel.requestToast', { dentist: visit.dentist.name }));
            }}
          >
            {t('panel.requestChange')}
          </button>
        </p>
      )}
      {!draft && canAudit && (
        <VisitAuditTrail
          visitId={visit.id}
          currency={visit.currency}
          names={names}
          timeZone={timeZone}
          locale={locale}
        />
      )}
    </RightPanel>
  );
}
