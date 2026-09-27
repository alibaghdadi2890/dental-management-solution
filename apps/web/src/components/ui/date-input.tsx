import { type InputHTMLAttributes, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTextOf, parseDateText } from '@/lib/date-text';
import type { DateInputOrder } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TextInput } from './field';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * A typed date in the tenant's day/month order (design Q17) rather than `<input type="date">`,
 * whose order follows the browser's locale data. `value` is ISO `YYYY-MM-DD` or `''`; while the
 * text isn't a whole valid date yet, `onChange` gets the text as typed, which the form's own
 * validation reports as an invalid date — so a half-typed date is never silently dropped.
 */
export function DateInput({
  value,
  onChange,
  order,
  className,
  ...props
}: NativeProps & {
  value: string;
  onChange: (value: string) => void;
  order: DateInputOrder;
}) {
  const { t } = useTranslation('common');
  const [text, setText] = useState(() => dateTextOf(value, order));
  const [shown, setShown] = useState(value);
  // A value set from outside (not by typing here) replaces the text.
  if (value !== shown) {
    setShown(value);
    setText(dateTextOf(value, order));
  }

  return (
    <TextInput
      {...props}
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      placeholder={t(`dateFormat.${order}`)}
      value={text}
      onChange={(event) => {
        const typed = event.target.value;
        const next = typed.trim() === '' ? '' : (parseDateText(typed, order) ?? typed.trim());
        setText(typed);
        setShown(next);
        onChange(next);
      }}
      className={cn('font-mono tabular-nums', className)}
    />
  );
}
