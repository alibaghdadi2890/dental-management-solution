import type { MedicalOption, MedicalOptionKind } from '@dcm/contracts';
import { MEDICAL_OPTION_KINDS } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-context';
import { ErrorState } from '@/components/ui/list';
import { SaveBar } from '@/components/ui/save-bar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import {
  deactivateMedicalOption,
  deleteMedicalOption,
  medicalOptionKeys,
  medicalOptionsQuery,
  saveMedicalOptions,
  seedMedicalOptions,
} from '@/features/patients/medical-history/medical-options-api';
import {
  addRow,
  applyOption,
  batchOf,
  changedRows,
  draftFrom,
  dropRow,
  duplicateKeys,
  editRow,
  missingCount,
  type OptionListsDraft,
  type OptionRow,
  rowsOf,
} from '@/features/patients/medical-history/option-lists-draft';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { CatalogView } from './catalog-draft';
import { CatalogFrame } from './catalog-frame';

/**
 * The Catalog's Medical history tab (feature 10, V14): the clinic's allergy and condition lists,
 * the chips a patient's history offers. Names are edited in place and saved in one batch, like
 * the services; an item a patient has cannot be deleted, only marked inactive, which takes it
 * out of the pickers and leaves it on those patients. Read-only without `catalog:write`.
 */
export function HistoryListsTab({ onTabChange }: { onTabChange: (tab: CatalogView) => void }) {
  const { t } = useTranslation('catalog');
  const options = useQuery(medicalOptionsQuery());

  if (options.data) {
    return <ListsEditor options={options.data} onTabChange={onTabChange} />;
  }
  return (
    <CatalogFrame tab="history" onTabChange={onTabChange}>
      {options.error ? (
        <section className="rounded-xl border border-border bg-surface">
          <ErrorState
            title={t('error.title')}
            body={t('error.body')}
            requestId={options.error instanceof ApiError ? options.error.requestId : undefined}
            error={options.error}
            onRetry={() => void options.refetch()}
          />
        </section>
      ) : (
        <CardSkeleton label={t('loading')} />
      )}
    </CatalogFrame>
  );
}

function ListsEditor({
  options,
  onTabChange,
}: {
  options: MedicalOption[];
  onTabChange: (tab: CatalogView) => void;
}) {
  const { t } = useTranslation(['catalog', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const canEdit = usePermission('catalog:write');
  const newKey = useRef(0);
  const [draft, setDraft] = useState<OptionListsDraft>(() => draftFrom(options));
  const [saving, setSaving] = useState(false);

  const changed = changedRows(draft);
  const missing = missingCount(draft);
  const duplicates = duplicateKeys(draft);
  const saveBlock =
    missing > 0
      ? t('history.missing', { count: missing })
      : duplicates.size > 0
        ? t('history.duplicate')
        : undefined;
  const readOnly = !canEdit || saving;

  /** What every form holding the chips reads: kept in step with each change made here. */
  const publish = (next: MedicalOption[]) => {
    queryClient.setQueryData(medicalOptionsQuery().queryKey, next);
    void queryClient.invalidateQueries({ queryKey: medicalOptionKeys.all });
  };

  const save = async () => {
    if (saveBlock || saving) return;
    setSaving(true);
    try {
      const saved = await saveMedicalOptions(batchOf(changed));
      setDraft(draftFrom(saved));
      publish(saved);
      toast(t('history.saved', { count: changed.length }));
    } catch (error) {
      toast(
        t('saveFailed', {
          reason: error instanceof Error && error.message ? error.message : t('common:unexpected'),
        }),
        {
          tone: 'danger',
        },
      );
    } finally {
      setSaving(false);
    }
  };

  const markInactive = (row: OptionRow & { id: string }) => {
    confirm({
      title: t('history.inUse.title', { name: row.name }),
      body: t('history.inUse.body'),
      okLabel: t('history.inUse.ok'),
      tone: 'warn',
      onConfirm: async () => {
        const option = await deactivateMedicalOption(row.id);
        setDraft((current) => applyOption(current, option));
        void queryClient.invalidateQueries({ queryKey: medicalOptionKeys.all });
      },
    });
  };

  const remove = (row: OptionRow) => {
    const { id } = row;
    if (id === undefined) {
      setDraft((current) => dropRow(current, row.key));
      return;
    }
    confirm({
      title: t('history.delete.title', { name: row.name }),
      body: t('history.delete.body'),
      okLabel: t('history.delete.ok'),
      tone: 'danger',
      onConfirm: async () => {
        try {
          await deleteMedicalOption(id);
          setDraft((current) => dropRow(current, row.key));
          void queryClient.invalidateQueries({ queryKey: medicalOptionKeys.all });
        } catch (error) {
          if (error instanceof ApiError && error.code === 'medical_option.in_use') {
            markInactive({ ...row, id });
            return;
          }
          toast(t('delete.failed', { name: row.name }), { tone: 'danger' });
        }
      },
    });
  };

  const seed = async () => {
    await seedMedicalOptions();
    const seeded = await queryClient.query({ ...medicalOptionsQuery(), staleTime: 0 });
    setDraft(draftFrom(seeded));
  };

  const list = (kind: MedicalOptionKind) => (
    <OptionList
      key={kind}
      kind={kind}
      rows={rowsOf(draft, kind)}
      duplicates={duplicates}
      readOnly={readOnly}
      canEdit={canEdit}
      onAdd={() => {
        newKey.current += 1;
        setDraft((current) => addRow(current, kind, `new-${String(newKey.current)}`));
      }}
      onChange={(key, patch) => {
        setDraft((current) => editRow(current, key, patch));
      }}
      onRemove={remove}
    />
  );

  return (
    <CatalogFrame
      tab="history"
      onTabChange={(next) => {
        // The lists and the catalogs are saved apart: leave nothing unsaved behind.
        if (next !== 'history' && changed.length > 0) {
          toast(t('history.saveFirst'), { tone: 'danger' });
          return;
        }
        onTabChange(next);
      }}
      footer={
        changed.length > 0 ? (
          <SaveBar
            label={t('unsaved', { count: changed.length })}
            error={saveBlock}
            saving={saving}
            onDiscard={() => {
              setDraft((current) => draftFrom(current.base.flatMap(toOption)));
            }}
            onSave={() => void save()}
          />
        ) : undefined
      }
    >
      <UnsavedChangesGuard when={changed.length > 0} />
      <p className="mb-3 text-[12.5px] leading-[1.45] text-ink-secondary">
        {t(canEdit ? 'history.intro' : 'readOnly')}
      </p>
      {draft.rows.length === 0 && canEdit && (
        <div className="mb-3">
          <Button variant="outline" onClick={() => void seed()}>
            {t('history.seed')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        {MEDICAL_OPTION_KINDS.map(list)}
      </div>
    </CatalogFrame>
  );
}

/** A saved row back as an option (new rows have no id and are dropped by a discard). */
const toOption = ({ id, kind, name, active }: OptionRow): MedicalOption[] =>
  id === undefined ? [] : [{ id, kind, name, active }];

function OptionList({
  kind,
  rows,
  duplicates,
  readOnly,
  canEdit,
  onAdd,
  onChange,
  onRemove,
}: {
  kind: MedicalOptionKind;
  rows: OptionRow[];
  duplicates: ReadonlySet<string>;
  readOnly: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Pick<OptionRow, 'name' | 'active'>>) => void;
  onRemove: (row: OptionRow) => void;
}) {
  const { t } = useTranslation('catalog');
  const title = t(`history.${kind}.title`);
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center gap-3 border-b border-inner-divider px-4 py-3">
        <h2 className="m-0 text-[14px] leading-none font-semibold">{title}</h2>
        <span className="text-[12.5px] leading-none text-ink-muted">
          {t('history.noneNote', { none: t(`history.${kind}.none`) })}
        </span>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={readOnly}
            onClick={onAdd}
          >
            {t(`history.${kind}.add`)}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 px-4 py-5 text-[12.5px] leading-normal text-ink-muted">
          {t('history.empty')}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const duplicate = duplicates.has(row.key);
            return (
              <li
                key={row.key}
                className="flex items-center gap-2.5 border-b border-row-divider px-4 py-2 last:border-b-0"
              >
                <input
                  type="text"
                  aria-label={t('history.name')}
                  aria-invalid={duplicate || row.name.trim() === '' || undefined}
                  maxLength={60}
                  readOnly={readOnly}
                  // A new row is typed straight away.
                  autoFocus={row.id === undefined && row.name === ''}
                  value={row.name}
                  onChange={(event) => {
                    onChange(row.key, { name: event.target.value });
                  }}
                  className={cn(
                    'h-[34px] min-w-0 flex-1 rounded-[7px] border border-border-control bg-surface px-2.5 text-[13px] text-ink aria-invalid:border-danger',
                    !row.active && 'text-ink-muted',
                  )}
                />
                <Switch
                  checked={row.active}
                  disabled={readOnly}
                  label={t('history.active', { name: row.name })}
                  onCheckedChange={(active) => {
                    onChange(row.key, { active });
                  }}
                />
                {canEdit && (
                  <button
                    type="button"
                    disabled={readOnly}
                    aria-label={t('history.deleteNamed', { name: row.name })}
                    onClick={() => {
                      onRemove(row);
                    }}
                    className="cursor-pointer border-0 bg-transparent p-1 text-[12.5px] leading-none font-medium text-danger hover:underline disabled:cursor-default disabled:opacity-50"
                  >
                    {t('history.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
