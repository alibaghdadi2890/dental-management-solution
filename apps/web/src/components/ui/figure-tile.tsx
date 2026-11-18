import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type SparkPoint, Sparkline } from '@/components/charts';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { changeTone, type GoodWhen } from './figure-tone';
import { InfoMark } from './info-mark';

const TONES = {
  good: 'border-success-border bg-success-bg text-success',
  bad: 'border-danger-border bg-danger-bg text-danger',
  neutral: 'border-border bg-subtle text-ink-secondary',
} as const;

/** The change against the comparison span: an arrow, a sign and a percent, coloured by meaning. */
export function ChangeChip({
  change,
  goodWhen,
  against,
}: {
  change: number | null;
  goodWhen: GoodWhen;
  /** What it is compared with, for screen readers ("vs 1–18 Oct"). */
  against: string;
}) {
  const { t, i18n } = useTranslation('dashboards');
  if (change === null) {
    return (
      <span className="text-[11.5px] text-ink-muted" title={t('tile.noComparison')}>
        {'—'}
      </span>
    );
  }
  const tone = changeTone(change, goodWhen);
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const words = t(`tile.change.${tone}`, {
    change: `${sign}${formatPercent(Math.abs(change), i18n.language)}`,
    against,
  });
  return (
    <span
      aria-label={words}
      title={words}
      className={cn(
        'inline-flex h-[20px] items-center gap-0.5 rounded-[5px] border px-1.5 font-mono text-[11px] leading-none font-medium tabular-nums',
        TONES[tone],
      )}
    >
      <span aria-hidden>{arrow}</span>
      <span aria-hidden dir="ltr">
        {sign}
        {formatPercent(Math.abs(change), i18n.language)}
      </span>
    </span>
  );
}

/**
 * A figure (feature 19, D4; the look of the lab account figures): the label and its **!**, the
 * value — the largest text on the page, mono, tabular, left to right —, the change chip, an
 * optional sparkline, and the whole tile a link to the rows behind it (`link`; without one it is
 * not a link). `now` marks a figure that ignores the period. `tone: 'bad'` colours a negative
 * value; no other value is coloured.
 */
export function FigureTile({
  label,
  info,
  value,
  exact,
  now = false,
  change,
  spark,
  link,
  tone,
  state = 'ready',
  aside,
  onRetry,
}: {
  label: string;
  info?: ReactNode;
  value: string;
  /** The exact value, on hover. */
  exact?: string | undefined;
  now?: boolean;
  change?: ReactNode;
  spark?: { points: readonly SparkPoint[]; color: string } | undefined;
  link?: ((content: ReactNode, className: string) => ReactNode) | undefined;
  tone?: 'bad';
  state?: 'ready' | 'loading' | 'error' | 'aside';
  /** The quiet line shown instead of the value (_All branches only_). */
  aside?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation('dashboards');
  const { t: common } = useTranslation('common');
  const body = (
    <>
      <span className="flex items-center gap-1.5 pe-6">
        <span className="text-[12px] text-ink-muted">{label}</span>
        {now && (
          <span className="rounded-[4px] bg-subtle px-1 py-[2px] text-[10px] leading-none font-medium text-ink-muted uppercase">
            {t('tile.now')}
          </span>
        )}
      </span>
      {state === 'loading' && (
        <span
          aria-busy="true"
          aria-label={t('card.loading', { title: label })}
          className="mt-2 block"
        >
          <span className="block h-6 w-24 rounded-[4px] bg-inner-divider" />
          <span className="mt-2 block h-3 w-14 rounded-[4px] bg-row-divider" />
        </span>
      )}
      {state === 'aside' && (
        <span className="mt-2 block text-[12.5px] text-ink-muted">{aside}</span>
      )}
      {state === 'error' && (
        <span className="mt-2 block text-[12.5px] text-danger">{t('card.error')}</span>
      )}
      {state === 'ready' && (
        <>
          <span
            title={exact}
            className={cn(
              'mt-1 block text-start font-mono text-[24px] leading-tight font-semibold tracking-[-0.01em] tabular-nums',
              tone === 'bad' && 'text-danger',
            )}
          >
            {/* Left to right inside, at the reading start of the tile. */}
            <bdi dir="ltr">{value}</bdi>
          </span>
          <span className="mt-1 flex min-h-5 items-center gap-2">{change}</span>
          {spark && (
            <span className="mt-1.5 block">
              <Sparkline points={spark.points} color={spark.color} />
            </span>
          )}
        </>
      )}
    </>
  );
  const frame =
    'relative flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface px-4 py-3 break-inside-avoid';
  return (
    <div className="relative h-full">
      {link && state === 'ready' ? (
        link(
          body,
          cn(
            frame,
            'transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
          ),
        )
      ) : (
        <div className={frame}>{body}</div>
      )}
      {info && (
        <span className="absolute end-3 top-3">
          <InfoMark about={label}>{info}</InfoMark>
        </span>
      )}
      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute end-3 bottom-3 cursor-pointer text-[12px] font-medium text-primary hover:underline"
        >
          {common('tryAgain')}
        </button>
      )}
    </div>
  );
}
