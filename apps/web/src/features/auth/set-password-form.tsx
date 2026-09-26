import { type ChangePasswordRequest, PASSWORD_MIN_LENGTH } from '@dcm/contracts';
import { type SubmitEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { AuthCard, PasswordInput } from './auth-card';

interface SetPasswordFormProps {
  /** The temporary password just used to sign in; asked for again after a reload. */
  temporaryPassword: string | undefined;
  submit: (request: ChangePasswordRequest) => Promise<unknown>;
  onDone: () => void | Promise<void>;
  onSignOut: () => void;
}

/** First sign-in with a temporary password (D6): same card, "Set a new password". */
export function SetPasswordForm({
  temporaryPassword,
  submit,
  onDone,
  onSignOut,
}: SetPasswordFormProps) {
  const { t } = useTranslation('auth');
  const ids = { current: useId(), next: useId(), confirm: useId() };
  const [current, setCurrent] = useState(temporaryPassword ?? '');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (next.length < PASSWORD_MIN_LENGTH) {
      setError(t('setPassword.errors.tooShort', { count: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (next !== confirm) {
      setError(t('setPassword.errors.mismatch'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await submit({ currentPassword: current, newPassword: next });
      await onDone();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      setError(
        code === 'auth.invalid_current_password'
          ? t('setPassword.errors.currentWrong')
          : code === 'auth.password_unchanged'
            ? t('setPassword.errors.unchanged')
            : t('setPassword.errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  const label = (htmlFor: string, text: string, hint?: string) => (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 flex justify-between text-[12.5px] leading-none font-medium"
    >
      <span>{text}</span>
      {hint && <span className="font-normal text-ink-muted">{hint}</span>}
    </label>
  );

  return (
    <AuthCard title={t('setPassword.title')} intro={t('setPassword.intro')} error={error}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        {temporaryPassword === undefined && (
          <div className="mb-3.5">
            {label(ids.current, t('setPassword.current'))}
            <PasswordInput
              id={ids.current}
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
          </div>
        )}
        <div className="mb-3.5">
          {label(
            ids.next,
            t('setPassword.new'),
            t('setPassword.hint', { count: PASSWORD_MIN_LENGTH }),
          )}
          <PasswordInput
            id={ids.next}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
          />
        </div>
        <div className="mb-5">
          {label(ids.confirm, t('setPassword.confirm'))}
          <PasswordInput
            id={ids.confirm}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" size="lg" variant="primary" busy={busy}>
          {busy ? t('setPassword.busy') : t('setPassword.submit')}
        </Button>
        <Button variant="ghost" size="lg" className="mt-2" onClick={onSignOut}>
          {t('setPassword.signOut')}
        </Button>
      </form>
    </AuthCard>
  );
}
