import { type RoleRef, SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@dcm/contracts';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const isSystemKey = (key: string): key is SystemRoleKey =>
  SYSTEM_ROLE_KEYS.some((systemKey) => systemKey === key);

/**
 * A role's display name: a system role (seeded with an English name; custom roles can't take
 * their keys) in the UI language, a custom role as its tenant named it (4a follow-up).
 */
export function useRoleLabel(): (role: RoleRef) => string {
  const { t } = useTranslation('common');
  return useCallback(
    (role: RoleRef) => (isSystemKey(role.key) ? t(`roles.${role.key}`) : role.name),
    [t],
  );
}
