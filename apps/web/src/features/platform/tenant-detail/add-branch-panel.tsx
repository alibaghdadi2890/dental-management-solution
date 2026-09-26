import { branchCreateSchema } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { createBranch, platformKeys } from '@/features/platform/platform-api';
import { ApiError } from '@/lib/api';

type BranchField = 'name' | 'code' | 'address' | 'phone';
const EMPTY: Record<BranchField, string> = { name: '', code: '', address: '', phone: '' };

export function AddBranchPanel({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<BranchField, string>>>({});
  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof createBranch>[1]) => createBranch(tenantId, body),
  });
  const dirty = Object.values(form).some((value) => value !== '');

  const submit = async () => {
    const parsed = branchCreateSchema.safeParse(form);
    if (!parsed.success) {
      setErrors({ name: t('newTenant.errors.required') });
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      await queryClient.invalidateQueries({ queryKey: platformKeys.branches(tenantId) });
      await queryClient.invalidateQueries({ queryKey: platformKeys.tenants });
      toast(t('branches.panel.created'));
      onClose();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === 'branch.name_taken') setErrors({ name: t('branches.panel.nameTaken') });
      else if (code === 'branch.code_taken') setErrors({ code: t('branches.panel.codeTaken') });
      else toast(t('common:unexpected'), { tone: 'danger' });
    }
  };

  const field = (key: BranchField, label: string, mono = false) => (
    <Field label={label} error={errors[key]}>
      {(props) => (
        <TextInput
          {...props}
          value={form[key]}
          className={mono ? 'font-mono' : undefined}
          onChange={(event) => {
            setForm((current) => ({ ...current, [key]: event.target.value }));
            setErrors((current) => ({ ...current, [key]: undefined }));
          }}
        />
      )}
    </Field>
  );

  return (
    <RightPanel
      eyebrow={t('branches.panel.eyebrow')}
      title={t('branches.panel.title')}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" busy={mutation.isPending} onClick={() => void submit()}>
            {t('branches.panel.submit')}
          </Button>
        </>
      }
    >
      {field('name', t('newTenant.fields.branchName'))}
      {field('code', t('branches.code'), true)}
      {field('address', t('newTenant.fields.address'))}
      {field('phone', t('newTenant.fields.phone'), true)}
    </RightPanel>
  );
}
