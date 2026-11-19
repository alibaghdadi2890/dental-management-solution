import type { InventoryCategory } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import {
  categoriesQuery,
  createCategory,
  deleteCategory,
  invalidateInventory,
  updateCategory,
} from './inventory-api';
import { useInventoryWords } from './inventory-words';

/**
 * The clinic's inventory categories (Part A), the expense categories' rules: the predefined ones
 * are turned off and on; the clinic's own are added, renamed, turned off, and deleted while unused.
 */
export function CategoriesPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n, categoryName } = useInventoryWords();
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useQuery(categoriesQuery());
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      await invalidateInventory(queryClient);
      return true;
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const row = (category: InventoryCategory) => (
    <li key={category.id} className="flex min-h-10 items-center gap-2 py-1">
      {renaming?.id === category.id ? (
        <TextInput
          autoFocus
          aria-label={t('categories.name')}
          value={renaming.name}
          maxLength={60}
          onChange={(event) => {
            setRenaming({ id: category.id, name: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && renaming.name.trim()) {
              void act(() => updateCategory(category.id, { name: renaming.name.trim() })).then(
                (done) => {
                  if (done) setRenaming(undefined);
                },
              );
            }
            if (event.key === 'Escape') setRenaming(undefined);
          }}
        />
      ) : (
        <span className={category.active ? 'flex-1' : 'flex-1 text-ink-muted'}>
          {categoryName(category)}
        </span>
      )}
      {category.key === null && renaming?.id !== category.id && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRenaming({ id: category.id, name: category.name ?? '' });
          }}
        >
          {t('categories.rename')}
        </Button>
      )}
      {category.key === null && !category.inUse && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void act(() => deleteCategory(category.id))}
        >
          {t('remove')}
        </Button>
      )}
      <Switch
        checked={category.active}
        label={t('categories.active', { name: categoryName(category) })}
        onCheckedChange={(active) => void act(() => updateCategory(category.id, { active }))}
      />
    </li>
  );
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        title={t('categories.title')}
        dirty={false}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void act(() => createCategory(name.trim())).then((done) => {
                if (done) setName('');
              });
            }}
          >
            <TextInput
              aria-label={t('categories.name')}
              placeholder={t('categories.name')}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {t('categories.add')}
            </Button>
          </form>
          <ul className="m-0 list-none divide-y divide-row-divider p-0">
            {(categories.data ?? []).map(row)}
          </ul>
        </div>
      </RightPanel>
    </>
  );
}
