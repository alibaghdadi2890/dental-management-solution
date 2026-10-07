import type { PresenceWhen } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { practitionersQuery } from '@/features/users/users-api';
import { dateInputOrder, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';

/** When, why and for whom a presence set on the patient record is recorded (H3a). */
export interface PresenceDetails {
  when: PresenceWhen;
  reason: string | null;
  /** The dentist the record is for, when the person saving isn't one. */
  dentistId?: string | undefined;
}

const REASON_MAX = 200;

/**
 * The small dialog a presence set on the patient record goes through before it is saved
 * (feature 7, H3a): *When* — "Before first visit" by default, because for a new patient the date
 * is not known and must not be invented, or a date not after today — an optional one-line
 * *Reason*, and the *Dentist* when the person saving isn't one (the same rule as a diagnosis
 * recorded outside a visit). One dialog for one tooth and for a whole batch.
 */
export function PresenceDialog({
  title,
  onSave,
  onClose,
}: {
  title: string;
  /** Saves; the dialog closes when it resolves and stays open, re-enabled, when it throws. */
  onSave: (details: PresenceDetails) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation(['clinical', 'common']);
  const { data: session } = useSession();
  const practitioners = useQuery(practitionersQuery());
  const whenId = useId();
  const tenant = session?.tenant;
  const today = todayIn(tenant?.timeZone ?? 'UTC');
  const [kind, setKind] = useState<PresenceWhen['kind']>('before_first_visit');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [dentistId, setDentistId] = useState('');
  const [saving, setSaving] = useState(false);

  // Until the staff list is in, assume the caller is a dentist: the server is the judge.
  const callerIsDentist =
    practitioners.data?.some((dentist) => dentist.userId === session?.user.id) ?? true;
  const dated = kind === 'date';
  const ready = (!dated || (date !== '' && date <= today)) && (callerIsDentist || dentistId !== '');

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await onSave({
        when: dated ? { kind: 'date', date } : { kind: 'before_first_visit' },
        reason: reason.trim() === '' ? null : reason.trim(),
        ...(callerIsDentist ? {} : { dentistId }),
      });
      onClose();
    } catch {
      // The caller has shown why; the dialog stays for another try.
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.28)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 animate-popin rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="border-b border-inner-divider px-5 pt-4 pb-3">
            <Dialog.Title className="m-0 text-[15px] leading-[1.25] font-semibold">
              {title}
            </Dialog.Title>
            <Dialog.Description className="m-0 mt-1 text-[12.5px] leading-snug text-ink-muted">
              {t('presence.popover.body')}
            </Dialog.Description>
          </div>
          <div className="flex flex-col gap-3.5 px-5 py-4">
            <div>
              <div id={whenId} className="mb-1.5 text-[12.5px] leading-none font-medium">
                {t('presence.popover.when')}
              </div>
              <div
                role="radiogroup"
                aria-labelledby={whenId}
                className="grid grid-cols-2 gap-0.5 rounded-lg border border-border-control bg-sunken p-0.5"
              >
                {(['before_first_visit', 'date'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={kind === option}
                    onClick={() => {
                      setKind(option);
                    }}
                    className={cn(
                      'h-[32px] cursor-pointer rounded-[6px] border-0 px-2 text-[12.5px] font-medium',
                      kind === option
                        ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(27,26,31,.14)]'
                        : 'bg-transparent text-ink-secondary hover:text-ink',
                    )}
                  >
                    {t(
                      option === 'date'
                        ? 'presence.popover.onDate'
                        : 'presence.popover.beforeFirstVisit',
                    )}
                  </button>
                ))}
              </div>
            </div>
            {dated && (
              <Field label={t('presence.popover.date')}>
                {(field) => (
                  <DateInput
                    {...field}
                    value={date}
                    onChange={setDate}
                    order={dateInputOrder(tenant?.country ?? 'LB')}
                    today={today}
                    pickerLabel={t('presence.popover.chooseDate')}
                  />
                )}
              </Field>
            )}
            <Field label={t('presence.popover.reason')} hint={t('presence.popover.optional')}>
              {(field) => (
                <TextInput
                  {...field}
                  value={reason}
                  maxLength={REASON_MAX}
                  placeholder={t('presence.popover.reasonPlaceholder')}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </Field>
            {!callerIsDentist && (
              <Field label={t('presence.popover.dentist')}>
                {(field) => (
                  <Select
                    {...field}
                    value={dentistId}
                    onChange={(event) => {
                      setDentistId(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      {t('presence.popover.chooseDentist')}
                    </option>
                    {practitioners.data?.map((dentist) => (
                      <option key={dentist.id} value={dentist.id}>
                        {dentist.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-inner-divider bg-sunken px-5 py-3">
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button variant="primary" disabled={!ready} busy={saving} onClick={() => void save()}>
              {t('presence.popover.save')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
