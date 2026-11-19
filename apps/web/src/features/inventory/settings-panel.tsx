import { EXPIRING_DAYS_MAX } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { InfoMark } from '@/components/ui/info-mark';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { invalidateInventory, settingsQuery, updateSettings } from './inventory-api';
import { useInventoryWords } from './inventory-words';

/** The clinic's expiring window (D9): how many days ahead a batch counts as _Expiring_. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery(settingsQuery());
  const [text, setText] = useState<string>();
  const [saving, setSaving] = useState(false);
  const value = text ?? (settings.data ? String(settings.data.expiringDays) : '');
  const days = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  const valid = days >= 1 && days <= EXPIRING_DAYS_MAX;
  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await updateSettings(days);
      await invalidateInventory(queryClient);
      onClose();
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        title={t('stock.expiryWindow')}
        dirty={text !== undefined}
        onClose={onClose}
        initialFocus="field"
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button variant="primary" busy={saving} disabled={!valid} onClick={() => void submit()}>
              {t('save')}
            </Button>
          </>
        }
      >
        <Field
          label={t('settings.days')}
          info={
            <>
              <InfoMark about={t('settings.days')}>{t('info.expiring')}</InfoMark>
            </>
          }
          error={value !== '' && !valid ? t('form.days') : undefined}
        >
          {(props) => (
            <TextInput
              {...props}
              inputMode="numeric"
              value={value}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </Field>
      </RightPanel>
    </>
  );
}
