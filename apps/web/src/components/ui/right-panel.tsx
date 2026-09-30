import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { IconButton } from './button';

const FIELDS =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const TABBABLE = `${FIELDS}, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`;

/** Keeps Tab inside a modal panel: from the last stop it wraps to the first, and back. */
function trapTab(event: KeyboardEvent<HTMLElement>): void {
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)];
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;
  const current = document.activeElement;
  const inside = stops.some((stop) => stop === current);
  if (event.shiftKey && (current === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

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
 *
 * The visit workspace's catalog drawer restyles it (spec §Add Service / Plan Treatment /
 * Diagnosis Drawer): no eyebrow, a `subtitle` under the title, a `toolbar` (search and chips)
 * at the foot of the header, and its own width, body and footer classes. It is also `modal`:
 * a `dialog` (`aria-modal`) that keeps Tab inside it, so nothing behind it — the chart's arrow
 * keys included — acts while it is open. Without `modal` the panel is a plain `aside`.
 */
export function RightPanel({
  eyebrow,
  title,
  subtitle,
  toolbar,
  dirty,
  onClose,
  closeDisabled = false,
  initialFocus = 'heading',
  footer,
  className,
  bodyClassName,
  footerClassName,
  modal = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  dirty: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  initialFocus?: 'heading' | 'field';
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
  modal?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  // A `div` when modal, else an `aside`: only `contains` and `querySelector` are used on it.
  const panelRef = useRef<HTMLDivElement>(null);
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

  const Root = modal ? 'div' : 'aside';
  return (
    <Root
      ref={panelRef}
      aria-label={title}
      {...(modal && { role: 'dialog', 'aria-modal': true })}
      onKeyDown={(event) => {
        if (modal && event.key === 'Tab') {
          trapTab(event);
          return;
        }
        if (event.key !== 'Escape' || closeDisabled || event.defaultPrevented) return;
        // Keys from a dialog portalled out of the panel bubble here through React, not the DOM.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'flex w-[440px] max-w-[48%] flex-none animate-slidein flex-col border-s border-border bg-surface',
        className,
      )}
    >
      <div className="flex-none border-b border-inner-divider px-[18px] pt-4 pb-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {eyebrow !== undefined && (
              <div className="mb-1.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase">
                {eyebrow}
              </div>
            )}
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-base leading-tight font-semibold tracking-[-0.01em] outline-none"
            >
              {title}
            </h2>
            {subtitle}
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
        {toolbar}
      </div>
      <div
        className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-[18px]', bodyClassName)}
      >
        {children}
      </div>
      {footer ? (
        <div
          className={cn(
            'flex flex-none items-center justify-end gap-2 border-t border-inner-divider px-[18px] py-3',
            footerClassName,
          )}
        >
          {footer}
        </div>
      ) : null}
    </Root>
  );
}
