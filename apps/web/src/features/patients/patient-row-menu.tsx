import type { PatientListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import type { PatientPanel } from './list-query';

/**
 * The row's ⋯ menu (README §Patients): Open record, Quick view, Edit details, Merge with {twin},
 * Archive or Restore. There is no Start visit (design §Patients list). Everything but Open record
 * and Quick view needs `patient:write`; an archived record can only be restored.
 */
export function PatientRowMenu({
  patient,
  twin,
  canWrite,
  disabled,
  busy,
  onPanel,
  onOpenRecord,
  onArchive,
  onRestore,
}: {
  patient: PatientListItem;
  /** Another record in the same duplicate group, if any. */
  twin: PatientListItem | undefined;
  canWrite: boolean;
  /** The row is a stale placeholder while the next query loads. */
  disabled: boolean;
  /** An archive or restore is running: those actions wait for it. */
  busy: boolean;
  onPanel: (panel: PatientPanel) => void;
  onOpenRecord: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation('patients');
  const archived = patient.archivedAt !== null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          aria-label={t('row.menu', { name: patient.fullName })}
          disabled={disabled}
          className="disabled:cursor-default disabled:opacity-45"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={onOpenRecord}>{t('menu.openRecord')}</MenuItem>
        <MenuItem
          onSelect={() => {
            onPanel({ kind: 'quick', id: patient.id });
          }}
        >
          {t('menu.quickView')}
        </MenuItem>
        {canWrite && !archived && (
          <MenuItem
            onSelect={() => {
              onPanel({ kind: 'edit', id: patient.id });
            }}
          >
            {t('menu.edit')}
          </MenuItem>
        )}
        {canWrite && !archived && twin && (
          <MenuItem
            onSelect={() => {
              onPanel({ kind: 'merge', ids: [patient.id, twin.id] });
            }}
          >
            {t('menu.merge', { number: twin.displayNumber })}
          </MenuItem>
        )}
        {canWrite &&
          (archived ? (
            <MenuItem disabled={busy} onSelect={onRestore}>
              {t('menu.restore')}
            </MenuItem>
          ) : (
            <MenuItem tone="danger" disabled={busy} onSelect={onArchive}>
              {t('menu.archive')}
            </MenuItem>
          ))}
      </MenuContent>
    </Menu>
  );
}
