import { AlertDialog } from 'radix-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { touchSession } from '@/features/auth/auth-api';
import { useIdleTimeout, WARNING_SECONDS } from '@/features/auth/use-idle-timeout';
import { useSignOut } from '@/features/auth/use-sign-out';

/** POC session-timeout dialog: 60 s countdown with an amber bar (D11). */
export function IdleTimeoutDialog({ idleSeconds }: { idleSeconds: number | null }) {
  const { t } = useTranslation('shell');
  const signOut = useSignOut();
  const touch = useCallback(() => {
    void touchSession().catch(() => undefined);
  }, []);
  const expire = useCallback(() => {
    void signOut('expired');
  }, [signOut]);
  const { secondsLeft, stay } = useIdleTimeout(idleSeconds, { touch, expire });

  if (secondsLeft === null || idleSeconds === null) return null;
  return (
    <AlertDialog.Root open>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] animate-fadein bg-[rgba(27,26,31,.34)]" />
        <AlertDialog.Content className="fixed start-1/2 top-1/2 z-[60] w-[calc(100%-48px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 animate-popin rounded-2xl border border-border bg-surface px-[22px] pt-[22px] pb-[18px] shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <div className="mb-2.5 text-[11.5px] leading-none font-medium tracking-[0.06em] text-warning uppercase">
            {t('idle.eyebrow')}
          </div>
          <AlertDialog.Title className="mb-1.5 text-base leading-tight font-semibold">
            {t('idle.title')}{' '}
            <span className="font-mono tabular-nums">{`0:${String(secondsLeft).padStart(2, '0')}`}</span>
          </AlertDialog.Title>
          <AlertDialog.Description className="mb-[18px] text-[13px] leading-normal text-ink-secondary">
            {t('idle.body', { count: Math.round(idleSeconds / 60) })}
          </AlertDialog.Description>
          <div className="mb-[18px] h-1 overflow-hidden rounded-sm bg-subtle">
            <div
              className="h-full bg-warning-dot transition-[width] duration-1000 ease-linear"
              style={{ width: `${(secondsLeft / WARNING_SECONDS) * 100}%` }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                void signOut();
              }}
            >
              {t('idle.signOut')}
            </Button>
            <Button variant="primary" onClick={stay}>
              {t('idle.stay')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
