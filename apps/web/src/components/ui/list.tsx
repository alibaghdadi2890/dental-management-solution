import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { SearchIcon } from './search-icon';

/** Saved-view tabs with count chips (POC list anatomy §2): 2px indigo underline when active. */
export function ViewTabs<TKey extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  /** `count` is shown as given: format it for the locale first. */
  tabs: { key: TKey; label: string; count?: number | string | undefined }[];
  active: TKey;
  onChange: (key: TKey) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-3.5 flex flex-wrap gap-0.5 border-b border-border"
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              onChange(tab.key);
            }}
            className={cn(
              '-mb-px flex h-[38px] cursor-pointer items-center gap-[7px] border-b-2 px-3 text-[13px] leading-none whitespace-nowrap',
              on
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-ink-secondary',
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-sm px-1.5 py-[3px] font-mono text-[11.5px] leading-none font-medium',
                  on ? 'bg-primary-tint text-primary' : 'bg-subtle text-ink-tertiary',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Search box of the POC filter bar. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  maxLength?: number;
}) {
  return (
    <label className="flex h-9 max-w-[360px] flex-[1_1_260px] items-center gap-2 rounded-lg border border-border-control bg-surface px-[11px]">
      <SearchIcon className="text-ink-muted" />
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={label}
        maxLength={maxLength}
        className="min-w-0 flex-1 border-none bg-transparent text-[13px] leading-none outline-none"
      />
    </label>
  );
}

/**
 * Table card: white, 10px radius, horizontally scrollable above `minWidth`. `toolbar` (the bulk
 * bar) and `footer` (the pager) sit inside the card but outside the scrolling area.
 */
export function TableCard({
  children,
  minWidth,
  toolbar,
  footer,
}: {
  children: ReactNode;
  minWidth: number;
  toolbar?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {toolbar}
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>{children}</div>
      </div>
      {footer}
    </section>
  );
}

/** 40px header row, 11.5px uppercase labels. `columns` is a CSS grid template. */
export function TableHead({ columns, labels }: { columns: string; labels: ReactNode[] }) {
  return (
    <div
      role="row"
      className="grid h-10 items-center gap-2.5 border-b border-border bg-faint px-3"
      style={{ gridTemplateColumns: columns }}
    >
      {labels.map((label, index) => (
        <span
          key={index}
          role="columnheader"
          className="text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** The POC loading shimmer (README §System states), for skeletons shaped like their screen. */
export const SHIMMER =
  'animate-shimmer rounded-sm bg-[linear-gradient(90deg,#f2f0ea_0,#faf8f4_50%,#f2f0ea_100%)] bg-[length:800px_100%]';

/** Loading state: shimmer rows at the real column widths. */
export function SkeletonRows({
  columns,
  rows = 6,
  label,
}: {
  columns: string;
  rows?: number;
  label: string;
}) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="grid h-14 items-center gap-2.5 border-t border-row-divider px-3"
          style={{ gridTemplateColumns: columns }}
        >
          {columns.split(' ').map((_, cell) => (
            <span key={cell} className={cn('h-2.5', SHIMMER, cell === 0 ? 'w-40' : 'w-14')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Empty / no-results message with an optional action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <h2 className="mb-1.5 text-[15px] leading-tight font-semibold">{title}</h2>
      <p className="mx-auto mb-4 max-w-[360px] text-[13px] leading-normal text-ink-tertiary">
        {body}
      </p>
      {action && <div className="flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Error state: red "!" circle, plain-language cause, request id in Mono, "Try again". */
export function ErrorState({
  title,
  body,
  requestId,
  onRetry,
}: {
  title: string;
  body: string;
  requestId?: string | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <div role="alert" className="px-6 py-14 text-center">
      <div className="mx-auto mb-3.5 grid size-10 place-items-center rounded-full border border-danger-border bg-danger-bg text-base leading-none font-bold text-danger">
        {'!'}
      </div>
      <h2 className="mb-1.5 text-[15px] leading-tight font-semibold">{title}</h2>
      <p className="mx-auto mb-4 max-w-[380px] text-[13px] leading-normal text-ink-tertiary">
        {body}{' '}
        {requestId && (
          <span className="font-mono text-xs">{t('requestId', { id: requestId })}</span>
        )}
      </p>
      <Button variant="dark" onClick={onRetry}>
        {t('tryAgain')}
      </Button>
    </div>
  );
}

const PILL_TONES = {
  success: 'border-success-border bg-success-bg text-success',
  neutral: 'border-border bg-subtle text-ink-secondary',
  indigo: 'border-primary-tint-border bg-primary-tint text-primary',
  warning: 'border-warning-border bg-warning-bg text-warning',
} as const;

/** Status / role pill: 22px, 5px radius. */
export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] flex-none items-center rounded-[5px] border px-2 text-[11.5px] leading-none font-medium whitespace-nowrap',
        PILL_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** 28px indigo square with an initial (tenant avatar); 52px on the detail header. */
export function TenantMark({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid flex-none place-items-center bg-primary font-mono leading-none font-semibold text-primary-foreground',
        size === 'lg' ? 'size-[52px] rounded-xl text-xl' : 'size-7 rounded-lg text-[13px]',
      )}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
