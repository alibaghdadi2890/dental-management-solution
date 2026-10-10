import type { DiagnosisItem, ServiceItem } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { EmptyState, ErrorState, SearchInput, SkeletonRows, ViewTabs } from '@/components/ui/list';
import { SaveBar } from '@/components/ui/save-bar';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { ApiError } from '@/lib/api';
import { currencySymbol } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  catalogKeys,
  deactivateDiagnosis,
  deactivateService,
  deleteCatalogRow,
  diagnosesQuery,
  saveDiagnoses,
  saveServices,
  servicesQuery,
} from './catalog-api';
import {
  addRow,
  applyDeactivated,
  applyDeleted,
  applySaved,
  batchOf,
  CATALOG_TABS,
  type CatalogDraft,
  type CatalogTab,
  categoriesOf,
  changeCount,
  changedRows,
  discarded,
  draftFrom,
  dropRow,
  duplicateCodes,
  type DraftRow,
  editRow,
  isRowChanged,
  missingCount,
  type RowPatch,
  serverRowErrors,
} from './catalog-draft';
import { CATALOG_GRID, STAR_PATH } from './catalog-layout';
import { CatalogRow } from './catalog-row';

const MIN_WIDTH = 1010;

/** Header, tabs and table frame shared by the loading/error states and the editor. */
function CatalogFrame({
  tab,
  onTabChange,
  counts,
  action,
  children,
  footer,
}: {
  tab: CatalogTab;
  onTabChange: (tab: CatalogTab) => void;
  counts?: Record<CatalogTab, number> | undefined;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation('catalog');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[1080px] px-[26px] pt-6 pb-8">
          <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
                {t('title')}
              </h1>
              <p className="text-[13px] leading-snug text-ink-tertiary">{t('subtitle')}</p>
            </div>
            {action}
          </div>
          <ViewTabs
            label={t('tabs.label')}
            active={tab}
            onChange={onTabChange}
            tabs={CATALOG_TABS.map((key) => ({
              key,
              label: t(`tabs.${key}`),
              count: counts?.[key],
            }))}
          />
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

function TableFrame({ tab, children }: { tab: CatalogTab; children: ReactNode }) {
  const { t } = useTranslation('catalog');
  const labels: { label: ReactNode; end?: boolean }[] = [
    { label: t('columns.code') },
    { label: t('columns.name') },
    {
      label: (
        <svg aria-label={t('columns.frequent')} width="12" height="12" viewBox="0 0 16 16">
          <path d={STAR_PATH} className="fill-none stroke-ink-muted" strokeWidth="1.4" />
        </svg>
      ),
    },
    ...(tab === 'services'
      ? [
          {
            label: (
              <span title={t('toothEffectHint')} className="cursor-help">
                {t('columns.toothEffect')}
              </span>
            ),
          },
        ]
      : []),
    { label: t('columns.category') },
    { label: t('columns.mark') },
    ...(tab === 'services'
      ? [{ label: t('columns.charged') }, { label: t('columns.price'), end: true }]
      : []),
    { label: t('columns.active') },
    { label: '' },
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <div role="table" aria-label={t(`tabs.${tab}`)} style={{ minWidth: MIN_WIDTH }}>
          <div
            role="row"
            className="grid h-10 items-center gap-2.5 border-b border-border bg-faint px-3.5"
            style={{ gridTemplateColumns: CATALOG_GRID[tab] }}
          >
            {labels.map(({ label, end }, index) => (
              <span
                key={index}
                role="columnheader"
                className={cn(
                  'text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase',
                  end ? 'text-end' : 'ps-2',
                )}
              >
                {label}
              </span>
            ))}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

function CategoryPills({
  categories,
  active,
  onChange,
}: {
  categories: string[];
  active: string | null;
  onChange: (category: string | null) => void;
}) {
  const { t } = useTranslation('catalog');
  const pills = [{ key: null, label: t('all') }, ...categories.map((c) => ({ key: c, label: c }))];
  return (
    <div role="group" aria-label={t('categories')} className="flex flex-wrap gap-1.5">
      {pills.map((pill) => {
        const on = pill.key === active;
        return (
          <button
            key={pill.key ?? ''}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(pill.key);
            }}
            className={cn(
              'h-[30px] cursor-pointer rounded-[15px] border px-[11px] text-[12.5px] leading-none font-medium',
              on ? 'border-ink bg-ink text-white' : 'border-border-control bg-surface text-ink',
            )}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}

interface Filters {
  q: string;
  category: string | null;
  showInactive: boolean;
}

const NO_FILTERS: Filters = { q: '', category: null, showInactive: true };

function visibleRows(rows: readonly DraftRow[], { q, category, showInactive }: Filters) {
  const query = q.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (showInactive || row.active) &&
      (category === null || row.category.trim() === category) &&
      (!query || row.name.toLowerCase().includes(query) || row.code.toLowerCase().includes(query)),
  );
}

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function CatalogEditor({
  services,
  diagnoses,
  tab,
  onTabChange,
}: {
  services: ServiceItem[];
  diagnoses: DiagnosisItem[];
  tab: CatalogTab;
  onTabChange: (tab: CatalogTab) => void;
}) {
  const { t, i18n } = useTranslation(['catalog', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canEdit = usePermission('catalog:write');
  const categoryListId = useId();
  const newKey = useRef(0);

  const [draft, setDraft] = useState<CatalogDraft>(() => draftFrom(services, diagnoses));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [serverErrors, setServerErrors] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);

  const readOnly = !canEdit || saving;
  const locale = i18n.resolvedLanguage ?? 'en';
  const tenantCurrency = session?.tenant?.currency ?? 'USD';

  const changes = changeCount(draft);
  const missing = missingCount(draft);
  const duplicates = useMemo(() => {
    const all = new Map<string, string>();
    for (const key of CATALOG_TABS) {
      for (const [rowKey, message] of duplicateCodes(draft, key)) all.set(rowKey, message);
    }
    for (const [rowKey, message] of serverErrors) all.set(rowKey, message);
    return all;
  }, [draft, serverErrors]);
  const saveBlock =
    missing > 0
      ? t('missing', { count: missing })
      : duplicates.size > 0
        ? t('duplicate', { count: duplicates.size })
        : undefined;

  const rows = draft.rows[tab];
  const categories = categoriesOf(rows);
  const shown = visibleRows(rows, filters);

  const refreshCatalog = () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });

  const change = (key: string, patch: RowPatch) => {
    setDraft((current) => editRow(current, tab, key, patch));
    if (serverErrors.has(key)) {
      setServerErrors((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    }
  };

  const add = () => {
    newKey.current += 1;
    setDraft((current) =>
      addRow(current, tab, `new-${String(newKey.current)}`, filters.category ?? ''),
    );
    setFilters((current) => ({ ...current, q: '' }));
  };

  const save = async () => {
    if (saveBlock || saving) return;
    setSaving(true);
    let current = draft;
    let savedCount = 0;
    const errors = new Map<string, string>();
    let failure: unknown;
    for (const key of CATALOG_TABS) {
      const sent = changedRows(current, key);
      if (sent.length === 0) continue;
      try {
        const items =
          key === 'services'
            ? await saveServices(batchOf('services', sent))
            : await saveDiagnoses(batchOf('diagnoses', sent));
        current = applySaved(current, key, items);
        savedCount += sent.length;
      } catch (error) {
        failure = error;
        if (error instanceof ApiError) {
          for (const [rowKey, message] of serverRowErrors(sent, error.problem.errors)) {
            errors.set(rowKey, message);
          }
        }
      }
    }
    setDraft(current);
    setServerErrors(errors);
    setSaving(false);
    void refreshCatalog();
    if (savedCount > 0) toast(t('saved', { count: savedCount }));
    if (failure !== undefined) {
      toast(t('saveFailed', { reason: reasonOf(failure, t('common:unexpected')) }), {
        tone: 'danger',
      });
    }
  };

  const discard = () => {
    confirm({
      title: t('discardTitle'),
      body: t('discardBody', { count: changes }),
      okLabel: t('common:discard'),
      tone: 'danger',
      onConfirm: () => {
        setDraft((current) => discarded(current));
        setServerErrors(new Map());
      },
    });
  };

  const markInactive = (id: string, name: string) => {
    confirm({
      title: t('inUse.title', { name }),
      body: t('inUse.body'),
      okLabel: t('inUse.ok'),
      tone: 'warn',
      onConfirm: async () => {
        const item =
          tab === 'services' ? await deactivateService(id) : await deactivateDiagnosis(id);
        setDraft((current) => applyDeactivated(current, tab, item));
        void refreshCatalog();
        toast(t('inUse.done', { name }));
      },
    });
  };

  const remove = (row: DraftRow) => {
    const { id } = row;
    if (id === undefined) {
      setDraft((current) => dropRow(current, tab, row.key));
      return;
    }
    const saved = draft.base[tab].find((candidate) => candidate.key === row.key);
    const name = saved?.name ?? row.name;
    confirm({
      title: t('delete.title', { name }),
      body: t('delete.body'),
      okLabel: t('delete.ok'),
      tone: 'danger',
      onConfirm: async () => {
        try {
          await deleteCatalogRow(tab, id);
          setDraft((current) => applyDeleted(current, tab, id));
          void refreshCatalog();
          toast(t('delete.done', { name }));
        } catch (error) {
          if (error instanceof ApiError && error.code === 'catalog.in_use') {
            markInactive(id, name);
            return;
          }
          toast(t('delete.failed', { name }), { tone: 'danger' });
        }
      },
    });
  };

  const counts = { services: draft.rows.services.length, diagnoses: draft.rows.diagnoses.length };

  let body: ReactNode;
  if (rows.length === 0) {
    body = (
      <EmptyState
        title={t('empty.title')}
        body={t(`empty.${tab}`)}
        action={
          canEdit ? (
            <Button variant="primary" onClick={add}>
              {t(`add.${tab}`)}
            </Button>
          ) : undefined
        }
      />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        title={t('noResults.title')}
        body={t('noResults.body')}
        action={
          <Button
            onClick={() => {
              setFilters(NO_FILTERS);
            }}
          >
            {t('noResults.clear')}
          </Button>
        }
      />
    );
  } else {
    body = shown.map((row) => (
      <CatalogRow
        key={row.key}
        tab={tab}
        row={row}
        readOnly={readOnly}
        changed={isRowChanged(draft, tab, row)}
        error={duplicates.get(row.key)}
        currency={currencySymbol(row.currency ?? tenantCurrency, locale)}
        categoryListId={categoryListId}
        onChange={(patch) => {
          change(row.key, patch);
        }}
        onDelete={() => {
          remove(row);
        }}
      />
    ));
  }

  return (
    <CatalogFrame
      tab={tab}
      onTabChange={(next) => {
        onTabChange(next);
        setFilters((current) => ({ ...current, category: null }));
      }}
      counts={counts}
      action={
        canEdit ? (
          <Button variant="outline" onClick={add}>
            {t(`add.${tab}`)}
          </Button>
        ) : undefined
      }
      footer={
        changes > 0 ? (
          <SaveBar
            label={t('unsaved', { count: changes })}
            error={saveBlock}
            saving={saving}
            onDiscard={discard}
            onSave={() => void save()}
          />
        ) : undefined
      }
    >
      <UnsavedChangesGuard when={changes > 0} />
      {!canEdit && (
        <div className="mb-3 rounded-lg border border-border bg-background px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-secondary">
          {t('readOnly')}
        </div>
      )}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <SearchInput
          value={filters.q}
          onChange={(q) => {
            setFilters((current) => ({ ...current, q }));
          }}
          placeholder={t('search.placeholder')}
          label={t('search.label')}
        />
        <CategoryPills
          categories={categories}
          active={filters.category}
          onChange={(category) => {
            setFilters((current) => ({ ...current, category }));
          }}
        />
        <label className="ms-auto flex cursor-pointer items-center gap-[7px] text-[12.5px] leading-none text-ink-secondary">
          <input
            type="checkbox"
            checked={filters.showInactive}
            onChange={() => {
              setFilters((current) => ({ ...current, showInactive: !current.showInactive }));
            }}
            className="m-0 size-[15px] accent-primary"
          />
          {t('showInactive')}
        </label>
      </div>
      <datalist id={categoryListId}>
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <TableFrame tab={tab}>{body}</TableFrame>
    </CatalogFrame>
  );
}

/** The Catalog screen (`Catalog.dc.html`): services and diagnoses, edited inline in batches. */
export function CatalogPage({
  tab,
  onTabChange,
}: {
  tab: CatalogTab;
  onTabChange: (tab: CatalogTab) => void;
}) {
  const { t } = useTranslation('catalog');
  const services = useQuery(servicesQuery());
  const diagnoses = useQuery(diagnosesQuery());

  if (services.data && diagnoses.data) {
    return (
      <CatalogEditor
        services={services.data}
        diagnoses={diagnoses.data}
        tab={tab}
        onTabChange={onTabChange}
      />
    );
  }
  const failed = services.error ?? diagnoses.error;
  return (
    <CatalogFrame tab={tab} onTabChange={onTabChange}>
      <TableFrame tab={tab}>
        {failed ? (
          <ErrorState
            title={t('error.title')}
            body={t('error.body')}
            requestId={failed instanceof ApiError ? failed.requestId : undefined}
            onRetry={() => {
              void services.refetch();
              void diagnoses.refetch();
            }}
          />
        ) : (
          <SkeletonRows columns={CATALOG_GRID[tab]} label={t('loading')} />
        )}
      </TableFrame>
    </CatalogFrame>
  );
}
