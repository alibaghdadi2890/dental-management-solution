import {
  type Adjustment,
  type CompensationStatement,
  formatVisitNumber,
  fromCents,
  type Payout,
  type StatementLine,
  toCents,
} from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { agreementWords } from './agreement-words';
import { formatMonth } from './months';

const FIGURE = 'font-mono tabular-nums';
const LINE_COLUMNS = '92px 96px minmax(120px,1fr) 128px 120px 112px';

function useMoney(currency: string) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  return (amount: string) => formatMoney({ amount, currency }, locale);
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <h3 className="m-0 text-[12px] font-medium text-ink-muted">{label}</h3>
      <p dir="ltr" className={cn('m-0 mt-2 text-[20px] font-semibold', FIGURE, tone)}>
        {value}
      </p>
    </section>
  );
}

/** What a line's "rate" column says: a percent (blended, with the lines behind it), a count ×
 * an amount, the days of a fixed amount, or "—". */
function RateCell({ line, money }: { line: StatementLine; money: (amount: string) => string }) {
  const { t } = useTranslation('compensation');
  if (line.kind === 'threshold') {
    return <>{t('statement.threshold', { amount: money(line.unitAmount ?? '0') })}</>;
  }
  if (line.kind === 'fixed') {
    return (
      <>{t('statement.days', { count: line.count ?? 0, amount: money(line.unitAmount ?? '0') })}</>
    );
  }
  if (line.kind === 'perVisit' || line.kind === 'perDay') {
    return (
      <>
        {line.kind === 'perDay'
          ? t('statement.dayVisits', { count: line.count ?? 0 })
          : `${String(line.count ?? 1)} × ${money(line.unitAmount ?? '0')}`}
      </>
    );
  }
  if (!line.rate) return <>{'—'}</>;
  const percent = `${line.rate.percent} %`;
  if (!line.rate.blended) return <>{percent}</>;
  return (
    <Tooltip
      label={line.rate.lines
        .map((part) => `${part.code}: ${money(part.amount)} × ${part.percent} %`)
        .join(' · ')}
    >
      <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
        {t('statement.blended', { percent })}
      </span>
    </Tooltip>
  );
}

function Lines({
  lines,
  money,
}: {
  lines: readonly StatementLine[];
  money: (amount: string) => string;
}) {
  const { t, i18n } = useTranslation('compensation');
  const locale = i18n.resolvedLanguage ?? 'en';
  return (
    <div role="table" className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div
          role="row"
          className="grid gap-2.5 px-1 pb-1.5 text-[11px] font-medium tracking-[0.05em] text-ink-muted uppercase"
          style={{ gridTemplateColumns: LINE_COLUMNS }}
        >
          <span role="columnheader">{t('statement.columns.date')}</span>
          <span role="columnheader">{t('statement.columns.visit')}</span>
          <span role="columnheader">{t('statement.columns.patient')}</span>
          <span role="columnheader" className="text-end">
            {t('statement.columns.base')}
          </span>
          <span role="columnheader" className="text-end">
            {t('statement.columns.rate')}
          </span>
          <span role="columnheader" className="text-end">
            {t('statement.columns.amount')}
          </span>
        </div>
        {lines.map((line) => (
          <div
            key={line.id}
            role="row"
            className="grid items-center gap-2.5 border-t border-row-divider px-1 py-2 text-[12.5px]"
            style={{ gridTemplateColumns: LINE_COLUMNS }}
          >
            <span role="cell">{formatCalendarDate(line.date, locale)}</span>
            <span role="cell" className="font-mono">
              {line.visitNumber === null ? '' : formatVisitNumber(line.visitNumber)}
            </span>
            <span role="cell" className="truncate">
              {line.patientName ?? ''}
              {line.visitType && (
                <span className="ms-1.5 text-ink-muted">{t(`visitTypes.${line.visitType}`)}</span>
              )}
              {line.source && line.source !== 'visit_charge' && line.source !== 'allocation' && (
                <span className="ms-1.5 text-ink-muted">{t(`sources.${line.source}`)}</span>
              )}
            </span>
            <span role="cell" dir="ltr" className={cn(FIGURE, 'text-end')}>
              {line.base === null ? '' : money(line.base)}
            </span>
            <span role="cell" className="text-end text-ink-secondary">
              <RateCell line={line} money={money} />
            </span>
            <span
              role="cell"
              dir="ltr"
              className={cn(
                FIGURE,
                'text-end font-semibold',
                toCents(line.amount) < 0n && 'text-danger',
              )}
            >
              {money(line.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({
  title,
  total,
  eyebrow,
  children,
}: {
  title: string;
  total?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-3 rounded-xl border border-border bg-surface px-4 py-3.5">
      {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[13.5px] font-semibold">{title}</h3>
        {total !== undefined && (
          <span dir="ltr" className={cn(FIGURE, 'text-[13.5px] font-semibold')}>
            {total}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** Adjustments and payouts: a voided row stays, struck through, its reason on hover. */
function MoneyRows<TRow extends Adjustment | Payout>({
  rows,
  label,
  detail,
  sign,
  money,
  onVoid,
}: {
  rows: readonly TRow[];
  label: (row: TRow) => string;
  detail: (row: TRow) => string | null;
  sign: 1 | -1;
  money: (amount: string) => string;
  onVoid?: ((row: TRow) => void) | undefined;
}) {
  const { t, i18n } = useTranslation('compensation');
  const locale = i18n.resolvedLanguage ?? 'en';
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((row) => {
        const voided = row.voidedAt !== null;
        const amount = sign < 0 ? fromCents(-toCents(row.amount)) : row.amount;
        const content = (
          <li
            key={row.id}
            tabIndex={voided ? 0 : undefined}
            className={cn(
              'flex items-center gap-3 border-t border-row-divider py-2 text-[12.5px]',
              voided && 'text-ink-muted line-through',
            )}
          >
            <span className="w-[92px] flex-none">{formatCalendarDate(row.date, locale)}</span>
            <span className="flex-none font-medium">{label(row)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-muted">{detail(row) ?? ''}</span>
            <span dir="ltr" className={cn(FIGURE, 'font-semibold')}>
              {money(amount)}
            </span>
            {onVoid && !voided && (
              <Button
                variant="ghost"
                size="sm"
                className="px-1 text-danger no-underline"
                onClick={() => {
                  onVoid(row);
                }}
              >
                {t('statement.void')}
              </Button>
            )}
          </li>
        );
        return voided ? (
          <Tooltip key={row.id} label={t('statement.voided', { reason: row.voidReason ?? '' })}>
            {content}
          </Tooltip>
        ) : (
          content
        );
      })}
    </ul>
  );
}

/**
 * A dentist's monthly statement (prompt §2–3): the header with the agreements in words and the
 * status, Opening · Earned · Paid · Closing, then Earned by component, late entries by the month
 * they belong to, lines without an agreement, Adjustments, Payouts and lines not computed. The
 * owner's page adds actions around it; the dentist's own page shows it read-only.
 */
export function StatementView({
  statement,
  provisionalNote,
  onVoidAdjustment,
  onVoidPayout,
}: {
  statement: CompensationStatement;
  provisionalNote?: boolean;
  onVoidAdjustment?: ((row: Adjustment) => void) | undefined;
  onVoidPayout?: ((row: Payout) => void) | undefined;
}) {
  const { t, i18n } = useTranslation(['compensation', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const money = useMoney(statement.currency);
  const { totals } = statement;
  const earned = toCents(totals.earned) + toCents(totals.late);
  const closing = toCents(totals.closing);
  const closed = statement.status === 'closed';
  const empty =
    statement.earned.length === 0 &&
    statement.late.length === 0 &&
    statement.noAgreement.length === 0 &&
    statement.adjustments.length === 0 &&
    statement.payouts.length === 0;

  return (
    <div>
      <header className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-semibold">{statement.dentistName}</h2>
          <p className="m-0 mt-1 text-[12.5px] text-ink-muted">
            {formatMonth(statement.month, locale)}
          </p>
          {statement.agreements.map((agreement) => (
            <p key={agreement.id} className="m-0 mt-1 text-[12.5px] text-ink-secondary">
              {agreementWords(agreement, {
                t: i18n.getFixedT(i18n.resolvedLanguage ?? 'en', 'compensation'),
                currency: statement.currency,
                locale,
              }).join(' · ')}
            </p>
          ))}
        </div>
        <Pill tone={closed ? 'success' : 'warning'}>
          {t(`compensation:status.${statement.status}`)}
        </Pill>
      </header>
      {provisionalNote && !closed && (
        <p className="m-0 mb-3.5 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {t('compensation:statement.provisionalNote')}
        </p>
      )}

      <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <Card label={t('compensation:statement.cards.opening')} value={money(totals.opening)} />
        <Card label={t('compensation:statement.cards.earned')} value={money(fromCents(earned))} />
        <Card label={t('compensation:statement.cards.paid')} value={money(totals.payouts)} />
        <Card
          label={
            closing < 0n
              ? t('compensation:statement.cards.owesClinic')
              : t('compensation:statement.cards.closing')
          }
          value={money(fromCents(closing < 0n ? -closing : closing))}
          tone={closing < 0n ? 'text-danger' : undefined}
        />
      </div>

      {empty && (
        <p className="m-0 mb-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-[12.5px] text-ink-muted">
          {statement.firstMonth === statement.month
            ? t('compensation:statement.emptyFirst')
            : t('compensation:statement.empty')}
        </p>
      )}

      {statement.earned.map((group) => (
        <Block
          key={group.component}
          title={t(`compensation:components.${group.component}`)}
          total={money(group.total)}
        >
          <Lines lines={group.lines} money={money} />
        </Block>
      ))}
      {statement.late.map((group) => (
        <Block
          key={group.month}
          eyebrow={t('compensation:statement.lateFrom', {
            month: formatMonth(group.month, locale),
          })}
          title={t('compensation:statement.late')}
          total={money(group.total)}
        >
          <Lines lines={group.lines} money={money} />
        </Block>
      ))}
      {statement.noAgreement.length > 0 && (
        <Block title={t('compensation:statement.noAgreement')}>
          <Lines lines={statement.noAgreement} money={money} />
        </Block>
      )}
      {statement.adjustments.length > 0 && (
        <Block title={t('compensation:statement.adjustments')} total={money(totals.adjustments)}>
          <MoneyRows
            rows={statement.adjustments}
            label={(row) => t(`compensation:adjustmentKinds.${row.kind}`)}
            detail={(row) => row.note}
            sign={1}
            money={money}
            onVoid={closed ? undefined : onVoidAdjustment}
          />
        </Block>
      )}
      {statement.payouts.length > 0 && (
        <Block
          title={t('compensation:statement.payouts')}
          total={money(fromCents(-toCents(totals.payouts)))}
        >
          <MoneyRows
            rows={statement.payouts}
            label={(row) => t(`billing:methods.${row.method}`)}
            detail={(row) => row.reference ?? row.note}
            sign={-1}
            money={money}
            onVoid={closed ? undefined : onVoidPayout}
          />
        </Block>
      )}
      {statement.notComputed.length > 0 && (
        <Block title={t('compensation:statement.notComputed')}>
          <p className="m-0 mb-2 text-[12px] text-ink-muted">
            {t('compensation:statement.notComputedHint')}
          </p>
          <Lines lines={statement.notComputed} money={money} />
        </Block>
      )}
    </div>
  );
}
