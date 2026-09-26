import type { BranchRef } from '@dcm/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-context';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { switchBranch } from '@/features/auth/auth-api';

const branchLine =
  'truncate font-mono text-[11.5px] leading-snug tracking-[0.04em] text-ink-muted uppercase';

/**
 * The clinic block's branch line. With more than one branch it is a switcher (D7); switching
 * refetches everything, since lists may be branch-scoped.
 */
export function BranchSwitcher({
  branch,
  branches,
}: {
  branch: BranchRef | null;
  branches: BranchRef[];
}) {
  const { t } = useTranslation('shell');
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (target: BranchRef) => switchBranch(target.id),
    onSuccess: async (_, target) => {
      await queryClient.invalidateQueries();
      toast(t('clinic.branchSwitched', { branch: target.name }));
    },
    onError: () => {
      toast(t('clinic.branchSwitchFailed'), { tone: 'danger' });
    },
  });

  if (!branch) return null;
  if (branches.length < 2) {
    return <div className={branchLine}>{t('clinic.branch', { branch: branch.name })}</div>;
  }
  return (
    <Menu>
      <MenuTrigger
        aria-label={t('clinic.switchBranch')}
        className="flex max-w-full cursor-pointer items-center gap-1 rounded-sm text-start hover:text-ink"
      >
        <span className={branchLine}>{t('clinic.branch', { branch: branch.name })}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="flex-none text-ink-muted"
        >
          <path d="m2.5 4 2.5 2.5L7.5 4" />
        </svg>
      </MenuTrigger>
      <MenuContent align="start">
        {branches.map((item) => (
          <MenuItem
            key={item.id}
            onSelect={() => {
              if (item.id !== branch.id) mutation.mutate(item);
            }}
          >
            <span className="flex w-full items-center gap-2.5">
              <span
                className={`size-[5px] flex-none rounded-full ${item.id === branch.id ? 'bg-primary' : 'bg-border-control'}`}
              />
              <span className={item.id === branch.id ? 'font-semibold text-primary' : undefined}>
                {item.name}
              </span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
