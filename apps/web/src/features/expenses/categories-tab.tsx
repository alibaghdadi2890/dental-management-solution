import type { ExpenseCategory } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { TextInput } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import { createCategory, deleteCategory, invalidateExpenses, updateCategory } from './expenses-api';
import { useCategoryName } from './expense-words';

const NAME_MAX = 60;

/**
 * The clinic's categories (A1, `expense:manage`, D7): add one; a custom one is renamed,
 * deactivated (kept on old expenses, gone from new ones) and deleted while unused; a predefined
 * one is deactivated only; *Other* and the system ones never change.
 */
export function CategoriesTab({ categories }: { categories: readonly ExpenseCategory[] }) {
  const { t, i18n } = useTranslation(['expenses', 'common']);
  const nameOf = useCategoryName();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    setError(undefined);
    try {
      await action();
      await invalidateExpenses(queryClient);
      toast(done, { tone: 'success' });
      return true;
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const add = async () => {
    if (name.trim() === '') return;
    if (
      await run('new', () => createCategory({ name: name.trim() }), t('expenses:categories.added'))
    ) {
      setName('');
    }
  };

  const rename = async () => {
    if (!renaming || renaming.name.trim() === '') return;
    const { id } = renaming;
    if (
      await run(
        id,
        () => updateCategory(id, { name: renaming.name.trim() }),
        t('expenses:categories.renamed'),
      )
    ) {
      setRenaming(undefined);
    }
  };

  return (
    <section className="max-w-[720px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <TextInput
          aria-label={t('expenses:categories.name')}
          placeholder={t('expenses:categories.name')}
          value={name}
          maxLength={NAME_MAX}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          className="max-w-[320px]"
        />
        <Button type="submit" variant="primary" busy={busy === 'new'} disabled={name.trim() === ''}>
          {t('expenses:categories.add')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mb-3 text-[12.5px] font-medium text-danger">
          {error}
        </p>
      )}
      <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-surface p-0">
        {categories.map((category) => {
          const editing = renaming?.id === category.id;
          return (
            <li
              key={category.id}
              className="flex min-h-12 items-center gap-3 border-t border-row-divider px-[18px] py-1.5 first:border-t-0"
            >
              {editing ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void rename();
                  }}
                >
                  <TextInput
                    aria-label={t('expenses:categories.name')}
                    value={renaming.name}
                    maxLength={NAME_MAX}
                    autoFocus
                    onChange={(event) => {
                      setRenaming({ id: category.id, name: event.target.value });
                    }}
                    className="max-w-[280px]"
                  />
                  <Button type="submit" size="sm" variant="primary" busy={busy === category.id}>
                    {t('expenses:categories.save')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setRenaming(undefined);
                    }}
                  >
                    {t('common:cancel')}
                  </Button>
                </form>
              ) : (
                <>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px] font-medium',
                      !category.active && 'text-ink-muted',
                    )}
                  >
                    {nameOf(category)}
                  </span>
                  {!category.active && (
                    <Pill tone="neutral">{t('expenses:categories.inactive')}</Pill>
                  )}
                  <span className="text-[12px] text-ink-muted">
                    {t(`expenses:categories.kind.${category.kind}`)}
                  </span>
                  <span className="flex gap-1.5">
                    {category.kind === 'custom' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setRenaming({ id: category.id, name: category.name ?? '' });
                        }}
                      >
                        {t('expenses:categories.rename')}
                      </Button>
                    )}
                    {(category.kind === 'custom' || category.kind === 'predefined') && (
                      <Button
                        size="sm"
                        busy={busy === category.id}
                        onClick={() =>
                          void run(
                            category.id,
                            () => updateCategory(category.id, { active: !category.active }),
                            category.active
                              ? t('expenses:categories.deactivated')
                              : t('expenses:categories.reactivated'),
                          )
                        }
                      >
                        {category.active
                          ? t('expenses:categories.deactivate')
                          : t('expenses:categories.reactivate')}
                      </Button>
                    )}
                    {category.kind === 'custom' && !category.inUse && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          confirm({
                            title: t('expenses:categories.deleteTitle', {
                              name: nameOf(category),
                            }),
                            body: t('expenses:categories.deleteBody'),
                            okLabel: t('expenses:categories.delete'),
                            tone: 'danger',
                            onConfirm: async () => {
                              try {
                                await deleteCategory(category.id);
                              } catch (failure) {
                                throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
                              }
                              await invalidateExpenses(queryClient);
                              toast(t('expenses:categories.deleted'), { tone: 'success' });
                            },
                          });
                        }}
                      >
                        {t('expenses:categories.delete')}
                      </Button>
                    )}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
