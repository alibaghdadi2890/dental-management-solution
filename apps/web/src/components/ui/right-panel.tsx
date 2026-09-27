import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './button';

const FIELDS =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * POC right panel: 440px, pushes the content (it sits in the page's flex row), slides in.
 * Header has an eyebrow, a 16px title, an "Unsaved" badge while dirty and a close button. The
 * footer bar is left out when there is nothing to put in it (a read-only quick view).
 *
 * Focus: on open it moves to the title — or, for a form (`initialFocus="field"`), to the first
 * field — and on close it goes back to whatever had it before (the row or button that opened the
 * panel), unless the person has since moved it elsewhere. Escape inside the panel closes it
 * through `onClose`, so a dirty panel's unsaved-changes prompt still applies. `closeDisabled`
 * (a save in flight) turns both the close button and Escape off.
 */
export function RightPanel({
  eyebrow,
  title,
  dirty,
  onClose,
  closeDisabled = false,
  initialFocus = 'heading',
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  dirty: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  initialFocus?: 'heading' | 'field';
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const field = initialFocus === 'field' ? panel?.querySelector<HTMLElement>(FIELDS) : null;
    (field ?? headingRef.current)?.focus();
    return () => {
      const current = document.activeElement;
      const focusWasHere =
        current === null || current === document.body || panel?.contains(current);
      if (opener?.isConnected && focusWasHere) opener.focus();
    };
  }, [initialFocus]);

  return (
    <aside
      ref={panelRef}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || closeDisabled || event.defaultPrevented) return;
        // Keys from a dialog portalled out of the panel bubble here through React, not the DOM.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        onClose();
      }}
      className="flex w-[440px] max-w-[48%] flex-none animate-slidein flex-col border-s border-border bg-surface"
    >
      <div className="flex flex-none items-start gap-3 border-b border-inner-divider px-[18px] pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
            {eyebrow}
          </div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base leading-tight font-semibold tracking-[-0.01em] outline-none"
          >
            {title}
          </h2>
        </div>
        {dirty && (
          <span className="mt-0.5 h-[22px] flex-none rounded-[5px] border border-warning-border bg-warning-bg px-2 text-[11.5px] leading-5 font-medium text-warning">
            {t('unsaved')}
          </span>
        )}
        <IconButton
          aria-label={t('close')}
          disabled={closeDisabled}
          onClick={onClose}
          className="disabled:cursor-not-allowed disabled:opacity-45"
        >
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
