import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function BulkButton({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-7 cursor-pointer rounded-md border border-primary-tint-border bg-surface px-2.5 text-[12.5px] leading-none font-medium disabled:cursor-not-allowed disabled:opacity-45',
        danger ? 'text-danger hover:border-danger' : 'text-primary hover:border-primary',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Shown while rows are selected (README §Patients, list anatomy 6): N selected · Merge 2 records
 * (exactly two) · Export · Archive or Restore · Clear selection. A missing handler hides its
 * button (the caller decides by permission and view).
 */
export function BulkBar({
  count,
  onMerge,
  onExport,
  onArchive,
  onRestore,
  onClear,
  archiving,
  exporting,
}: {
  count: number;
  /** An archive or restore is running. */
  archiving: boolean;
  /** An export is downloading. */
  exporting: boolean;
  onMerge: (() => void) | undefined;
  onExport: (() => void) | undefined;
  onArchive: (() => void) | undefined;
  onRestore: (() => void) | undefined;
  onClear: () => void;
}) {
  const { t } = useTranslation('patients');
  return (
    <div
      role="toolbar"
      aria-label={t('bulk.selected', { count })}
      className="flex flex-wrap items-center gap-2.5 border-b border-primary-tint-border bg-primary-tint px-3 py-2"
    >
      <span className="me-1.5 text-[12.5px] leading-none font-semibold text-primary">
        {t('bulk.selected', { count })}
      </span>
      {onMerge && <BulkButton onClick={onMerge}>{t('bulk.merge')}</BulkButton>}
      {onExport && (
        <BulkButton disabled={exporting} onClick={onExport}>
          {t('bulk.export')}
        </BulkButton>
      )}
      {onArchive && (
        <BulkButton danger disabled={archiving} onClick={onArchive}>
          {t('bulk.archive')}
        </BulkButton>
      )}
      {onRestore && (
        <BulkButton danger disabled={archiving} onClick={onRestore}>
          {t('bulk.restore')}
        </BulkButton>
      )}
      <button
        type="button"
        onClick={onClear}
        className="ms-auto h-7 cursor-pointer px-2 text-[12.5px] leading-none font-medium text-primary hover:underline"
      >
        {t('bulk.clear')}
      </button>
    </div>
  );
}
