import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './button';

/**
 * POC right panel: 440px, pushes the content (it sits in the page's flex row), slides in.
 * Header has an eyebrow, a 16px title, an "Unsaved" badge while dirty and a close button. The
 * footer bar is left out when there is nothing to put in it (a read-only quick view).
 */
export function RightPanel({
  eyebrow,
  title,
  dirty,
  onClose,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  dirty: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <aside
      aria-label={title}
      className="flex w-[440px] max-w-[48%] flex-none animate-slidein flex-col border-s border-border bg-surface"
    >
      <div className="flex flex-none items-start gap-3 border-b border-inner-divider px-[18px] pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
            {eyebrow}
          </div>
          <h2 className="text-base leading-tight font-semibold tracking-[-0.01em]">{title}</h2>
        </div>
        {dirty && (
          <span className="mt-0.5 h-[22px] flex-none rounded-[5px] border border-warning-border bg-warning-bg px-2 text-[11.5px] leading-5 font-medium text-warning">
            {t('unsaved')}
          </span>
        )}
        <IconButton aria-label={t('close')} onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6">
            <path d="m2 2 6 6M8 2 2 8" />
          </svg>
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-[18px]">{children}</div>
      {footer ? (
        <div className="flex flex-none items-center justify-end gap-2 border-t border-inner-divider px-[18px] py-3">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}
