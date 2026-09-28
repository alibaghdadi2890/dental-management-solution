import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { DayPicker } from 'react-day-picker';
import { ar, enUS, fr } from 'react-day-picker/locale';

/** The app languages' calendar locales: month and weekday names, the week's first day (Sunday in
 * English, Monday in French, Saturday in Arabic) and the calendar's own screen-reader labels. */
const LOCALES: Partial<Record<string, typeof enUS>> = { en: enUS, ar, fr };

/** The month arrows; an unavailable month is `aria-disabled` (still focusable), and in RTL the
 * arrows turn to point the way the months run. */
const NAV_BUTTON =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-[7px] text-ink-secondary hover:bg-subtle aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent rtl:[&>svg]:rotate-180';

/**
 * The shadcn-style calendar: react-day-picker in the app's language and direction, styled with
 * the POC tokens (indigo selection, 7px radius, Mono figures). Callers choose the mode, the
 * selectable range and the caption layout.
 */
export function Calendar(props: ComponentProps<typeof DayPicker>) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return (
    <DayPicker
      locale={LOCALES[language] ?? enUS}
      dir={i18n.dir(language)}
      classNames={{
        root: 'text-[13px] text-ink',
        months: 'relative',
        month: 'flex flex-col gap-2',
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
        button_previous: NAV_BUTTON,
        button_next: NAV_BUTTON,
        chevron: 'size-4 fill-current',
        month_caption: 'flex h-8 items-center justify-center px-9',
        caption_label:
          'inline-flex items-center gap-0.5 ps-2.5 pe-1.5 text-[12.5px] leading-none font-medium [&>svg]:text-ink-muted',
        dropdowns: 'flex items-center gap-1.5',
        dropdown_root:
          'relative inline-flex h-[30px] items-center rounded-md border border-border-control bg-surface hover:border-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring',
        dropdown: 'absolute inset-0 w-full cursor-pointer opacity-0',
        month_grid: 'border-collapse',
        weekday: 'size-9 p-0 text-[11.5px] font-medium text-ink-muted',
        day: 'p-0 text-center',
        day_button:
          'inline-flex size-9 cursor-pointer items-center justify-center rounded-[7px] font-mono text-[13px] tabular-nums hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent',
        today: 'font-semibold text-primary',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary-hover',
        outside: 'text-ink-disabled',
        disabled: 'text-ink-disabled',
        hidden: 'invisible',
      }}
      {...props}
    />
  );
}
