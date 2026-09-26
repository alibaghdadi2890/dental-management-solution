import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** POC login frame: centred 380px column, brand block, 12px-radius card, access notice. */
export function AuthCard({
  title,
  intro,
  notice,
  error,
  children,
}: {
  title: string;
  intro: string;
  notice?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation(['auth', 'common', 'shell']);
  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center bg-background px-5 py-8">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-primary font-mono text-sm leading-none font-semibold text-primary-foreground">
            {t('shell:brand.mark')}
          </div>
          <div>
            <div className="text-[15px] leading-tight font-semibold">{t('common:appName')}</div>
            <div className="font-mono text-[11.5px] leading-snug tracking-[0.04em] text-ink-muted uppercase">
              {t('auth:brand.tagline')}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-6 pt-6 pb-[22px]">
          <h1 className="mb-1 text-[19px] leading-tight font-semibold tracking-[-0.02em]">
            {title}
          </h1>
          <p className="mb-5 text-[13px] leading-[1.45] text-ink-tertiary">{intro}</p>
          {notice && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] leading-[1.45] text-[#5c4a22]"
            >
              {notice}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
            >
              {error}
            </div>
          )}
          {children}
        </div>

        <p className="mt-[22px] text-[11.5px] leading-normal text-ink-muted">
          {t('auth:signIn.footer')}
        </p>
      </div>
    </div>
  );
}

/** 40px password input with the POC's Show/Hide toggle inside the frame. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
}) {
  const { t } = useTranslation('auth');
  const [visible, setVisible] = useState(false);
  return (
    <span
      className={cn(
        'flex h-10 items-center rounded-lg border bg-surface pe-1',
        invalid ? 'border-danger' : 'border-border-control',
      )}
    >
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        autoComplete={autoComplete}
        aria-invalid={invalid}
        className="h-full min-w-0 flex-1 rounded-lg border-none bg-transparent px-[11px] text-[13.5px] leading-none outline-none"
      />
      <button
        type="button"
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="h-[30px] cursor-pointer rounded-[5px] px-[9px] text-xs leading-none font-medium text-ink-secondary hover:bg-background"
      >
        {visible ? t('signIn.hide') : t('signIn.show')}
      </button>
    </span>
  );
}
