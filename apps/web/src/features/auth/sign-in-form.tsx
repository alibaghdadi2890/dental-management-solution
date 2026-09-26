import type { SignInRequest } from '@dcm/contracts';
import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { AuthCard, PasswordInput } from './auth-card';
import { signInFailure } from './sign-in-failure';

interface SignInFormProps {
  notice?: string | undefined;
  /** Called after the session cookie is set, with the password (a first sign-in reuses it). */
  onSignedIn: (password: string) => void | Promise<void>;
  submit: (request: SignInRequest) => Promise<unknown>;
}

export function SignInForm({ notice, onSignedIn, submit }: SignInFormProps) {
  const { t } = useTranslation('auth');
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Minutes left on an account lock; cleared when the lock runs out. */
  const [lock, setLock] = useState<{ until: Date; minutes: number }>();
  const locked = lock !== undefined;

  useEffect(() => {
    if (!lock) return undefined;
    const timer = window.setTimeout(() => {
      setLock(undefined);
      setError(undefined);
    }, lock.until.getTime() - Date.now());
    return () => {
      window.clearTimeout(timer);
    };
  }, [lock]);

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || locked) return;
    if (!email.trim() || !password) {
      setError(t('errors.missing'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await submit({ email: email.trim().toLowerCase(), password, rememberMe: remember });
      await onSignedIn(password);
    } catch (caught) {
      const failure = signInFailure(caught);
      if (failure.kind === 'invalid') {
        setError(t('errors.invalid', { count: failure.attemptsLeft }));
      } else if (failure.kind === 'locked') {
        setLock({
          until: failure.lockedUntil,
          minutes: Math.max(1, Math.ceil((failure.lockedUntil.getTime() - Date.now()) / 60_000)),
        });
        setError(t('errors.locked'));
      } else if (failure.kind === 'deactivated') {
        setError(t('errors.deactivated'));
      } else {
        setError(t('errors.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('signIn.title')} intro={t('signIn.intro')} notice={notice} error={error}>
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor={emailId} className="mb-1.5 block text-[12.5px] leading-none font-medium">
          {t('signIn.email')}
        </label>
        <TextInput
          id={emailId}
          type="email"
          inputSize="lg"
          autoComplete="username"
          placeholder={t('signIn.emailPlaceholder')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(undefined);
          }}
          className="mb-3.5"
        />
        <label htmlFor={passwordId} className="mb-1.5 block text-[12.5px] leading-none font-medium">
          {t('signIn.password')}
        </label>
        <div className="mb-3">
          <PasswordInput
            id={passwordId}
            value={password}
            autoComplete="current-password"
            onChange={(value) => {
              setPassword(value);
              setError(undefined);
            }}
          />
        </div>
        <label className="mb-5 flex cursor-pointer items-center gap-2 text-[12.5px] leading-none text-ink-secondary">
          <input
            type="checkbox"
            checked={remember}
            onChange={() => {
              setRemember((current) => !current);
            }}
            className="m-0 size-[15px] accent-primary"
          />
          {t('signIn.trust')}
        </label>
        <Button
          type="submit"
          size="lg"
          variant="primary"
          busy={busy}
          disabled={locked}
          className={cn(locked && 'border-ink-muted bg-ink-muted disabled:opacity-100')}
        >
          {busy
            ? t('signIn.busy')
            : locked
              ? t('signIn.locked', { count: lock.minutes })
              : t('signIn.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
