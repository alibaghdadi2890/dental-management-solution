import { PATIENT_PAGE_SIZES, type PatientListQuery } from '@dcm/contracts';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { pageRange, pageWindow } from './pager';

function PageButton({
  children,
  current = false,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  current?: boolean;
  disabled?: boolean;
  label?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-[30px] min-w-[30px] rounded-md border px-2 font-mono text-[12.5px] leading-none font-medium',
        current
          ? 'border-primary bg-primary text-primary-foreground'
          : disabled
            ? 'border-transparent bg-surface text-ink-disabled'
            : 'cursor-pointer border-border bg-surface text-ink',
      )}
    >
      {children}
    </button>
  );
}

const figure = <b className="font-mono font-semibold text-ink" />;

/** "Showing 11–20 of 54", the Rows select and numbered pages (README §Patients, anatomy 7). */
export function PagerBar({
  page,
  size,
  total,
  onPage,
  onSize,
}: {
  page: number;
  size: PatientListQuery['size'];
  total: number;
  onPage: (page: number) => void;
  onSize: (size: PatientListQuery['size']) => void;
}) {
  const { t } = useTranslation('patients');
  const range = pageRange(page, size, total);
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-faint px-3 py-2.5">
      <span className="text-[12.5px] leading-none text-ink-secondary">
        <Trans
          t={t}
          i18nKey="pager.showing"
          values={{ from: range.from, to: range.to, total: range.total }}
          components={{ range: figure, total: figure }}
        />
      </span>
      <label className="flex items-center gap-1.5 text-[12.5px] leading-none text-ink-secondary">
        {t('pager.rows')}
        <select
          value={size}
          onChange={(event) => {
            const next = PATIENT_PAGE_SIZES.find((s) => String(s) === event.target.value);
            if (next !== undefined) onSize(next);
          }}
          className="h-7 cursor-pointer rounded-md border border-border-control bg-surface px-1 font-mono text-[12.5px] leading-none font-medium"
        >
          {PATIENT_PAGE_SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label={t('pager.label')} className="ms-auto flex items-center gap-1">
        <PageButton
          label={t('pager.previous')}
          disabled={range.page <= 1}
          onClick={() => {
            onPage(range.page - 1);
          }}
        >
          {'‹'}
        </PageButton>
        {pageWindow(range.page, range.last).map((token, index) =>
          token === 'gap' ? (
            <span
              key={`gap-${String(index)}`}
              aria-hidden
              className="grid h-[30px] min-w-[30px] place-items-center font-mono text-[12.5px] leading-none text-ink-disabled"
            >
              {'…'}
            </span>
          ) : (
            <PageButton
              key={token}
              current={token === range.page}
              onClick={() => {
                onPage(token);
              }}
            >
              {token}
            </PageButton>
          ),
        )}
        <PageButton
          label={t('pager.next')}
          disabled={range.page >= range.last}
          onClick={() => {
            onPage(range.page + 1);
          }}
        >
          {'›'}
        </PageButton>
      </nav>
    </div>
  );
}
