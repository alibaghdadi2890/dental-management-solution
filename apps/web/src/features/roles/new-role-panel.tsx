import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { useRoleLabel } from '@/features/users/role-label';
import { ApiError } from '@/lib/api';
import type { RoleRow, RolesSource } from './roles-source';

/**
 * **New role** (ADR-0055): a name, a description and, optionally, a role to start from. A new
 * platform default role starts switched off (ADR-0056).
 */
export function NewRolePanel({
  source,
  roles,
  onClose,
  onCreated,
}: {
  source: RolesSource;
  roles: readonly RoleRow[];
  onClose: () => void;
  onCreated: (role: RoleRow) => void;
}) {
  const { t } = useTranslation(['roles', 'common']);
  const roleLabel = useRoleLabel();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const dirty = name !== '' || description !== '' || copyFrom !== '';

  const submit = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      const role = await source.create({
        name: name.trim(),
        description: description.trim() || null,
        ...(copyFrom === '' ? {} : { copyFrom }),
      });
      await Promise.all(
        source.refresh.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      toast(t('newRole.created'));
      onCreated(role);
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === 'role.cannot_grant'
          ? t('errors.cannotGrant')
          : t('common:unexpected'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <RightPanel
      title={t('newRole.title')}
      dirty={dirty}
      onClose={onClose}
      initialFocus="field"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={name.trim() === ''}
            onClick={() => void submit()}
          >
            {t('newRole.create')}
          </Button>
        </>
      }
    >
      {failure && (
        <div
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
        >
          {failure}
        </div>
      )}
      <Field label={t('newRole.name')}>
        {(props) => (
          <TextInput
            {...props}
            value={name}
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t('newRole.description')} hint={t('newRole.descriptionHint')}>
        {(props) => (
          <TextInput
            {...props}
            value={description}
            maxLength={300}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t('newRole.startFrom')}>
        {(props) => (
          <Select
            {...props}
            value={copyFrom}
            onChange={(event) => {
              setCopyFrom(event.target.value);
            }}
          >
            <option value="">{t('newRole.startEmpty')}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.key}>
                {roleLabel(role)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </RightPanel>
  );
}
