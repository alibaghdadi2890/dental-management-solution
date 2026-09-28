import { Popover } from 'radix-ui';
import { type InputHTMLAttributes, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calendarDateOf, dateTextOf, isoOfCalendarDate, parseDateText } from '@/lib/date-text';
import type { DateInputOrder } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Calendar } from './calendar';
import { TextInput } from './field';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/** The calendar's earliest year when the caller sets no `min`: the year dropdown needs a start. */
const CALENDAR_FLOOR = '1900-01-01';

function CalendarIcon() {
  return (
    <svg
      aria-hidden
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="flex-none"
    >
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.5" />
      <path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3" />
    </svg>
  );
}

/**
 * A typed date in the tenant's day/month order (design Q17) rather than `<input type="date">`,
 * whose order follows the browser's locale data, with a calendar button that opens a date picker
 * (month and year dropdowns, the app's language and direction). `value` is ISO `YYYY-MM-DD` or
 * `''`; while the text isn't a whole valid date yet, `onChange` gets the text as typed, which the
 * form's own validation reports as an invalid date — so a half-typed date is never silently
 * dropped. It asks for a text keyboard: a phone's numeric pad has no `/` to type the separators
 * with.
 *
 * The calendar offers `min`…`max` (inclusive ISO dates; `max` defaults to the tenant's `today`, so
 * future days are disabled) and opens on the current value's month, else on today's — the year
 * dropdown makes a date decades back two picks away. Picking a day writes it as if typed, closes
 * the calendar and puts focus back in the input.
 */
export function DateInput({
  value,
  onChange,
  order,
  today,
  min = CALENDAR_FLOOR,
  max = today,
  pickerLabel,
  className,
  ...props
}: NativeProps & {
  value: string;
  onChange: (value: string) => void;
  order: DateInputOrder;
  /** The calendar button's accessible name, naming its field ("Choose date of birth"): a form
   * with two date fields must not have two buttons called just "Choose date". */
  pickerLabel: string;
  /** Today in the tenant's timezone (`todayIn`), marked in the calendar. */
  today: string;
  min?: string;
  max?: string;
}) {
  const { t } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // Closed by a click or focus elsewhere: focus stays where the person put it.
  const interactedOutside = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(() => dateTextOf(value, order));
  const [shown, setShown] = useState(value);
  // A value set from outside (not by typing here) replaces the text.
  if (value !== shown) {
    setShown(value);
    setText(dateTextOf(value, order));
  }

  const commit = (next: string, typed: string) => {
    setText(typed);
    setShown(next);
    onChange(next);
  };

  const selected = calendarDateOf(value);
  const todayDate = calendarDateOf(today);
  const first = calendarDateOf(min);
  const last = calendarDateOf(max);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div dir="ltr" className="relative">
          <TextInput
            {...props}
            ref={inputRef}
            inputMode="text"
            autoComplete="off"
            placeholder={t(`dateFormat.${order}`)}
            value={text}
            onChange={(event) => {
              const typed = event.target.value;
              commit(
                typed.trim() === '' ? '' : (parseDateText(typed, order) ?? typed.trim()),
                typed,
              );
            }}
            className={cn('pe-10 font-mono tabular-nums', className)}
          />
          {/* The button stays on the input's physical right in RTL too: the wrapper is LTR like
              the digits, so it sits after the date's end, where the typed text never runs. */}
          <Popover.Trigger asChild>
            <button
              ref={buttonRef}
              type="button"
              aria-label={pickerLabel}
              disabled={Boolean(props.disabled) || Boolean(props.readOnly)}
              className="absolute end-1 top-1/2 inline-flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-subtle hover:text-ink disabled:cursor-default disabled:opacity-45"
            >
              <CalendarIcon />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          aria-label={t('datePicker.calendar')}
          // The calendar focuses the selected day (else today) itself, so arrows move by day.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            interactedOutside.current = false;
          }}
          onInteractOutside={(event) => {
            const { target } = event;
            // The button toggling it shut counts as the calendar's own control, not "elsewhere".
            if (!(target instanceof Node && buttonRef.current?.contains(target))) {
              interactedOutside.current = true;
            }
          }}
          // Esc, a picked day or the button: back to the input to go on typing.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!interactedOutside.current) inputRef.current?.focus();
          }}
          className="z-30 animate-fadein rounded-[10px] border border-border bg-surface p-3 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
        >
          <Calendar
            mode="single"
            required
            autoFocus
            captionLayout="dropdown"
            selected={selected}
            defaultMonth={selected ?? todayDate}
            today={todayDate}
            startMonth={first}
            endMonth={last}
            disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
            onSelect={(date) => {
              const iso = isoOfCalendarDate(date);
              commit(iso, dateTextOf(iso, order));
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
