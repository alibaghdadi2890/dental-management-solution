import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/ui/date-input';
import { Eyebrow, Field, TextInput } from '@/components/ui/field';
import { MoneyInput } from '@/features/billing/money-input';
import type { DateInputOrder } from '@/lib/format';

/**
 * The create panel's "Account" group (design Q1, create only, `payment:write`): the opening
 * balance as typed (36px Mono, tenant currency after it), its "as of" date and an optional note.
 * The owner keeps the values and turns the typed amount into one (`amountValue`). As of and Note
 * belong to a recorded balance, so they are disabled until the amount is above zero: a blank or
 * zero amount records nothing, and they would be dropped.
 */
export function AccountFields({
  amountText,
  asOf,
  note,
  recording,
  errors,
  currency,
  locale,
  order,
  today,
  onAmount,
  onAsOf,
  onNote,
}: {
  /** The amount exactly as typed. */
  amountText: string;
  asOf: string;
  note: string;
  /** Whether the amount is above zero, i.e. a balance will be recorded (`wantsOpeningBalance`). */
  recording: boolean;
  errors: { amount?: string | undefined; asOf?: string | undefined; note?: string | undefined };
  currency: string;
  locale: string;
  order: DateInputOrder;
  /** Today in the tenant's timezone: "As of" is never later. */
  today: string;
  onAmount: (typed: string) => void;
  onAsOf: (value: string) => void;
  onNote: (value: string) => void;
}) {
  const { t } = useTranslation(['billing', 'common']);
  return (
    <>
      <Eyebrow className="mt-1">{t('account.title')}</Eyebrow>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
        <Field
          label={t('account.openingBalance')}
          hint={t('account.openingBalanceHint')}
          error={errors.amount}
        >
          {(props) => (
            <MoneyInput
              {...props}
              value={amountText}
              currency={currency}
              locale={locale}
              onChange={onAmount}
            />
          )}
        </Field>
        <Field label={t('account.asOf')} hint={t(`common:dateFormat.${order}`)} error={errors.asOf}>
          {(props) => (
            <DateInput
              {...props}
              order={order}
              today={today}
              pickerLabel={t('account.chooseAsOf')}
              disabled={!recording}
              value={asOf}
              onChange={onAsOf}
            />
          )}
        </Field>
        <Field label={t('account.note')} error={errors.note} className="col-span-2">
          {(props) => (
            <TextInput
              {...props}
              placeholder={t('account.notePlaceholder')}
              disabled={!recording}
              value={note}
              onChange={(event) => {
                onNote(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </>
  );
}
