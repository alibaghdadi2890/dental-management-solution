import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function BulkButton({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 cursor-pointer rounded-md border border-primary-tint-border bg-surface px-2.5 text-[12.5px] leading-none font-medium',
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
}: {
  count: number;
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
      {onExport && <BulkButton onClick={onExport}>{t('bulk.export')}</BulkButton>}
      {onArchive && (
        <BulkButton danger onClick={onArchive}>
          {t('bulk.archive')}
        </BulkButton>
      )}
      {onRestore && (
        <BulkButton danger onClick={onRestore}>
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
