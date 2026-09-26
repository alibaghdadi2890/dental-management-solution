import { PASSWORD_MIN_LENGTH, passwordSchema, type StaffUser } from '@dcm/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { resetUserPassword } from '@/features/platform/platform-api';
import { generateTemporaryPassword } from '@/features/platform/temporary-password';

/**
 * Sets a new temporary password (ADR-0012): the user is signed out everywhere and must choose
 * their own at next sign-in. The admin hands the password over out of band.
 */
export function ResetPasswordPanel({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: StaffUser;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const [password, setPassword] = useState(generateTemporaryPassword);
  const [error, setError] = useState<string>();
  const mutation = useMutation({
    mutationFn: (value: string) => resetUserPassword(tenantId, user.id, value),
  });

  const submit = async () => {
    if (!passwordSchema.safeParse(password).success) {
      setError(t('users.errors.password', { count: PASSWORD_MIN_LENGTH }));
      return;
    }
    try {
      await mutation.mutateAsync(password);
      toast(t('users.reset.done', { name: user.displayName }));
      onClose();
    } catch {
      toast(t('common:unexpected'), { tone: 'danger' });
    }
  };

  return (
    <RightPanel
      eyebrow={t('users.reset.eyebrow')}
      title={user.displayName}
      dirty={false}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" busy={mutation.isPending} onClick={() => void submit()}>
            {t('users.reset.submit')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-normal text-ink-tertiary">{t('users.reset.body')}</p>
      <Field
        label={t('newTenant.fields.password')}
        hint={t('newTenant.fields.passwordHint')}
        error={error}
      >
        {(props) => (
          <div className="flex gap-2">
            <TextInput
              {...props}
              value={password}
              autoComplete="off"
              onChange={(event) => {
                setPassword(event.target.value);
                setError(undefined);
              }}
              className="font-mono"
            />
            <Button
              variant="outline"
              onClick={() => {
                setPassword(generateTemporaryPassword());
                setError(undefined);
              }}
            >
              {t('newTenant.fields.generate')}
            </Button>
          </div>
        )}
      </Field>
    </RightPanel>
  );
}
