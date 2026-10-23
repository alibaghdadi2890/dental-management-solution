import {
  CAPABILITY_GROUPS,
  capabilityI18nKey,
  closeImplied,
  type GrantablePermission,
  impliedBy,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The permission editor of Settings › Roles and of a person's Access tab (ADR-0055): the
 * capability catalog in its groups, one switch per permission with its label and description; the
 * raw key only as a tooltip. `value` is what this editor sets (a role's permissions, or a
 * person's grants). `locked` are on already from elsewhere (their roles), shown on and disabled
 * with a caption; a permission another one needs is ticked with it and stays on while it is.
 */
export function CapabilityMatrix({
  value,
  onChange,
  locked,
  readOnly = false,
  errors,
}: {
  value: readonly GrantablePermission[];
  onChange?: ((next: GrantablePermission[]) => void) | undefined;
  /** Permission → caption, e.g. "from Front desk". */
  locked?: ReadonlyMap<GrantablePermission, string> | undefined;
  readOnly?: boolean | undefined;
  /** Permission → message, shown under its switch (a 403 `role.cannot_grant`). */
  errors?: ReadonlyMap<GrantablePermission, string> | undefined;
}) {
  const { t } = useTranslation('roles');
  const own = new Set(value);
  const held = [...own, ...(locked?.keys() ?? [])];

  const toggle = (permission: GrantablePermission, on: boolean) => {
    if (!onChange) return;
    onChange(on ? closeImplied([...own, permission]) : value.filter((item) => item !== permission));
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        {CAPABILITY_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`capability-group-${group.key}`}>
            <h3
              id={`capability-group-${group.key}`}
              className="mb-2 text-[11.5px] leading-tight font-semibold tracking-[0.06em] text-ink-tertiary uppercase"
            >
              {t(`group.${group.key}`)}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {group.permissions.map((permission) => {
                const stem = capabilityI18nKey(permission);
                const label = t(`capability.${stem}.label` as 'capability.patient_read.label');
                const fromElsewhere = locked?.get(permission);
                const neededBy = impliedBy(permission, held);
                const on =
                  own.has(permission) || fromElsewhere !== undefined || neededBy.length > 0;
                const pinned = fromElsewhere !== undefined || neededBy.length > 0;
                const [firstNeeding] = neededBy;
                const caption =
                  fromElsewhere ??
                  (firstNeeding
                    ? t('matrix.implied', {
                        permission: t(
                          `capability.${capabilityI18nKey(firstNeeding)}.label` as 'capability.patient_read.label',
                        ),
                      })
                    : undefined);
                const error = errors?.get(permission);
                return (
                  <li key={permission} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Tooltip label={<span className="font-mono">{permission}</span>} side="top">
                        <span className="text-[13.5px] leading-snug font-medium">{label}</span>
                      </Tooltip>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-tertiary">
                        {t(
                          `capability.${stem}.description` as 'capability.patient_read.description',
                        )}
                      </p>
                      {caption && (
                        <p className="mt-1 text-[12px] leading-snug font-medium text-primary">
                          {caption}
                        </p>
                      )}
                      {error && (
                        <p
                          role="alert"
                          className="mt-1 text-[12px] leading-snug font-medium text-danger"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                    <div className={cn('pt-0.5', (readOnly || pinned) && 'opacity-70')}>
                      <Switch
                        checked={on}
                        disabled={readOnly || pinned || !onChange}
                        label={label}
                        onCheckedChange={(checked) => {
                          toggle(permission, checked);
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </TooltipProvider>
  );
}
