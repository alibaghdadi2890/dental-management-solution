import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tabId = (idBase: string, key: string) => `${idBase}-tab-${key}`;
const panelId = (idBase: string, key: string) => `${idBase}-panel-${key}`;

/** The keys that move focus along a tab list, as a step (or an end) in reading order. */
function moveOf(key: string, rtl: boolean): 'next' | 'previous' | 'first' | 'last' | null {
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'ArrowRight') return rtl ? 'previous' : 'next';
  if (key === 'ArrowLeft') return rtl ? 'next' : 'previous';
  return null;
}

const isRtl = (element: HTMLElement) =>
  (element.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.dir) === 'rtl';

/**
 * WAI-ARIA tabs with manual activation: the selected tab is the one Tab stop (roving `tabIndex`);
 * ←/→ (mirrored right-to-left) move focus between tabs, wrapping, and Home/End jump to the ends;
 * Enter, Space or a click selects. Selecting is the caller's (`onChange`) — it may be a
 * navigation that an unsaved-changes guard holds back, which is why focus alone never selects.
 * Pair with `TabPanel` under the same `idBase`.
 */
export function Tabs<TKey extends string>({
  idBase,
  label,
  tabs,
  active,
  onChange,
  className,
}: {
  idBase: string;
  label: string;
  tabs: readonly { key: TKey; label: string }[];
  active: TKey;
  onChange: (key: TKey) => void;
  className?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = moveOf(event.key, isRtl(event.currentTarget));
    if (!move) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = buttons.findIndex((button) => button === document.activeElement);
    const last = buttons.length - 1;
    const next =
      move === 'first'
        ? 0
        : move === 'last'
          ? last
          : move === 'next'
            ? current >= last
              ? 0
              : current + 1
            : current <= 0
              ? last
              : current - 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex gap-0.5', className)}
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            id={tabId(idBase, tab.key)}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={on ? panelId(idBase, tab.key) : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) onChange(tab.key);
            }}
            className={cn(
              '-mb-px h-9 cursor-pointer border-b-2 px-[13px] text-[12.5px] leading-none whitespace-nowrap',
              on
                ? 'border-primary font-semibold text-ink'
                : 'border-transparent font-medium text-ink-tertiary hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** The selected tab's panel, labelled by its tab. */
export function TabPanel({
  idBase,
  tabKey,
  children,
  className,
}: {
  idBase: string;
  tabKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={panelId(idBase, tabKey)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, tabKey)}
      className={className}
    >
      {children}
    </div>
  );
}
