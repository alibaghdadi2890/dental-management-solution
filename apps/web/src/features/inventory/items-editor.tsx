import { INVENTORY_PACK_KEYS, INVENTORY_UNIT_KEYS } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { InfoMark } from '@/components/ui/info-mark';
import { ErrorState, SearchInput, SkeletonRows, TableCard, TableHead } from '@/components/ui/list';
import { SaveBar } from '@/components/ui/save-bar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import {
  categoriesQuery,
  invalidateInventory,
  itemsQuery,
  saveItems,
  suppliersQuery,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';
import { type DraftItem, draftOf, inputOf, same } from './items-draft';
import { matchesItem } from './item-match';

const COLUMNS =
  'minmax(180px,1.6fr) 100px minmax(140px,1fr) 110px 110px 80px 90px minmax(130px,1fr) 80px 64px 64px';

/**
 * _Edit items_ (Part A, the owner's layout answer): the Stock list as the Catalog's inline grid —
 * every row editable, new rows at the top, the sticky save bar with the count of changes; a row
 * the server refuses shows why. The unit and pack size of an item that has moved stay.
 */
export function ItemsEditor({ onDone }: { onDone: () => void }) {
  const { t, i18n, categoryName, unitWord, packWord } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const unitsId = useId();
  const packsId = useId();
  const items = useQuery(itemsQuery());
  const categories = useQuery(categoriesQuery());
  const suppliers = useQuery(suppliersQuery());
  const [rows, setRows] = useState<DraftItem[]>();
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const stored = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, draftOf(item)] as const)),
    [items.data],
  );
  const draft = rows ?? (items.data ?? []).map(draftOf);
  const changed = draft.filter((row) => {
    const before = row.id ? stored.get(row.id) : undefined;
    return before === undefined ? row.name.trim() !== '' : !same(before, row);
  });
  const firstCategory = categories.data?.find((row) => row.active)?.id ?? '';

  const edit = (key: string, patch: Partial<DraftItem>) => {
    setRows(draft.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveItems({ items: changed.map(inputOf) });
      await invalidateInventory(queryClient);
      setRows(undefined);
      setErrors(new Map());
      toast(t('editor.saved', { count: changed.length }), { tone: 'success' });
    } catch (error) {
      if (error instanceof ApiError && error.problem.errors) {
        const next = new Map<string, string>();
        for (const issue of error.problem.errors) {
          const index = /^items\.(\d+)\./.exec(issue.path)?.[1];
          const row = index === undefined ? undefined : changed[Number(index)];
          if (row && !next.has(row.key)) next.set(row.key, issue.message);
        }
        setErrors(next);
      }
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const visible = draft.filter((row) => !row.id || matchesItem(row, query));
  const cell =
    'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] hover:border-border-control focus:border-primary focus:outline-none';

  return (
    <>
      <UnsavedChangesGuard when={changed.length > 0} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('back')}
        </Button>
        <h2 className="m-0 text-[15px] font-semibold">{t('stock.editItems')}</h2>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('filters.search')}
          label={t('filters.search')}
        />
        <Button
          variant="primary"
          className="ms-auto"
          onClick={() => {
            setRows([
              {
                key: crypto.randomUUID(),
                id: undefined,
                moved: false,
                name: '',
                code: '',
                categoryId: firstCategory,
                unit: 'piece',
                packName: '',
                packSize: '',
                reorderLevel: '',
                usualSupplierId: '',
                usualOrderPacks: '',
                tracksExpiry: false,
                note: '',
                active: true,
              },
              ...draft,
            ]);
          }}
        >
          {t('editor.add')}
        </Button>
      </div>
      <datalist id={unitsId}>
        {INVENTORY_UNIT_KEYS.map((key) => (
          <option key={key} value={key}>
            {unitWord(key, 1)}
          </option>
        ))}
      </datalist>
      <datalist id={packsId}>
        {INVENTORY_PACK_KEYS.map((key) => (
          <option key={key} value={key}>
            {packWord(key, 1)}
          </option>
        ))}
      </datalist>
      <TableCard minWidth={1300}>
        <div role="table" aria-label={t('stock.editItems')}>
          <TableHead
            columns={COLUMNS}
            labels={[
              t('editor.columns.name'),
              t('editor.columns.code'),
              t('editor.columns.category'),
              <span key="u" className="flex items-center gap-1">
                {t('editor.columns.unit')}
                <InfoMark about={t('editor.columns.unit')}>{t('info.unitLocked')}</InfoMark>
              </span>,
              t('editor.columns.pack'),
              t('editor.columns.packSize'),
              t('editor.columns.reorderLevel'),
              t('editor.columns.supplier'),
              t('editor.columns.usualOrder'),
              t('editor.columns.expiry'),
              t('editor.columns.active'),
            ]}
          />
          {items.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('loading')} />
          ) : items.isError ? (
            <ErrorState
              title={t('failed.title')}
              body={t('failed.body')}
              error={items.error}
              onRetry={() => void items.refetch()}
            />
          ) : (
            visible.map((row) => {
              const error = errors.get(row.key);
              const before = row.id ? stored.get(row.id) : undefined;
              const dirty = before === undefined ? row.name !== '' : !same(before, row);
              return (
                <div key={row.key} role="row" className="border-t border-row-divider">
                  <div
                    className={cn(
                      'grid items-center gap-2 px-3 py-1 text-[13px]',
                      dirty && 'bg-warning-bg/40',
                      error && 'bg-danger-bg/50',
                    )}
                    style={{ gridTemplateColumns: COLUMNS }}
                  >
                    <input
                      aria-label={t('editor.columns.name')}
                      className={cn(cell, 'font-medium')}
                      value={row.name}
                      maxLength={120}
                      placeholder={t('editor.columns.name')}
                      onChange={(event) => {
                        edit(row.key, { name: event.target.value });
                      }}
                    />
                    <input
                      aria-label={t('editor.columns.code')}
                      className={cn(cell, 'font-mono')}
                      value={row.code}
                      maxLength={40}
                      onChange={(event) => {
                        edit(row.key, { code: event.target.value });
                      }}
                    />
                    <select
                      aria-label={t('editor.columns.category')}
                      className={cell}
                      value={row.categoryId}
                      onChange={(event) => {
                        edit(row.key, { categoryId: event.target.value });
                      }}
                    >
                      {(categories.data ?? [])
                        .filter((category) => category.active || category.id === row.categoryId)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {categoryName(category)}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label={t('editor.columns.unit')}
                      className={cell}
                      list={unitsId}
                      value={row.unit}
                      disabled={row.moved}
                      maxLength={30}
                      onChange={(event) => {
                        edit(row.key, { unit: event.target.value });
                      }}
                    />
                    <input
                      aria-label={t('editor.columns.pack')}
                      className={cell}
                      list={packsId}
                      value={row.packName}
                      disabled={row.moved}
                      maxLength={30}
                      onChange={(event) => {
                        edit(row.key, { packName: event.target.value });
                      }}
                    />
                    <input
                      aria-label={t('editor.columns.packSize')}
                      className={cn(cell, 'tabular-nums')}
                      inputMode="numeric"
                      value={row.packSize}
                      disabled={row.moved}
                      onChange={(event) => {
                        edit(row.key, { packSize: event.target.value.replace(/\D/g, '') });
                      }}
                    />
                    <input
                      aria-label={t('editor.columns.reorderLevel')}
                      className={cn(cell, 'tabular-nums')}
                      inputMode="numeric"
                      value={row.reorderLevel}
                      onChange={(event) => {
                        edit(row.key, { reorderLevel: event.target.value.replace(/\D/g, '') });
                      }}
                    />
                    <select
                      aria-label={t('editor.columns.supplier')}
                      className={cell}
                      value={row.usualSupplierId}
                      onChange={(event) => {
                        edit(row.key, { usualSupplierId: event.target.value });
                      }}
                    >
                      <option value="">—</option>
                      {(suppliers.data ?? []).map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={t('editor.columns.usualOrder')}
                      className={cn(cell, 'tabular-nums')}
                      inputMode="numeric"
                      value={row.usualOrderPacks}
                      onChange={(event) => {
                        edit(row.key, { usualOrderPacks: event.target.value.replace(/\D/g, '') });
                      }}
                    />
                    <span className="flex justify-center">
                      <input
                        type="checkbox"
                        aria-label={t('editor.columns.expiry')}
                        checked={row.tracksExpiry}
                        onChange={(event) => {
                          edit(row.key, { tracksExpiry: event.target.checked });
                        }}
                      />
                    </span>
                    <span className="flex justify-center">
                      <Switch
                        checked={row.active}
                        label={t('editor.columns.active')}
                        onCheckedChange={(active) => {
                          edit(row.key, { active });
                        }}
                      />
                    </span>
                  </div>
                  {error && (
                    <p role="alert" className="m-0 px-4 pb-1.5 text-[12px] font-medium text-danger">
                      {error}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </TableCard>
      {changed.length > 0 && (
        <div className="sticky bottom-0 -mx-[26px] mt-4">
          <SaveBar
            label={t('editor.unsaved', { count: changed.length })}
            saving={saving}
            onDiscard={() => {
              setRows(undefined);
              setErrors(new Map());
            }}
            onSave={() => void save()}
          />
        </div>
      )}
    </>
  );
}
