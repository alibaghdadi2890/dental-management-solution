import {
  FILE_CATEGORIES,
  FILE_SUB_CATEGORIES,
  type FileCategory,
  formatVisitNumber,
  type Patient,
  type PatientFile,
  type Session,
  type ToothCode,
} from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { EmptyState, FilterChip, SearchInput } from '@/components/ui/list';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FileTile } from '../file-tile';
import { useFileText } from '../file-text';
import {
  applyFiles,
  downloadFile,
  invalidateFiles,
  patientFilesQuery,
  updateFiles,
} from '../files-api';
import { useFiles } from '../files-context';
import { ToothField } from '../tooth-field';
import { useArchiveFiles } from '../use-archive-files';
import type { VisitOption } from '../visit-options';
import {
  type CategoryFilter,
  filterFiles,
  type GalleryFilter,
  groupByTaken,
  isArchived,
  isFiltered,
  linkedVisits,
  NO_FILTER,
  type TakenGroup,
} from './gallery-filter';

type Tenant = NonNullable<Session['tenant']>;

const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', ...FILE_CATEGORIES, 'documents'];
/** What `GET /files` returns at most (spec D8). */
const LIST_LIMIT = 1000;

const BULK_BUTTON =
  'h-7 cursor-pointer rounded-md border border-primary-tint-border bg-surface px-2.5 text-[12.5px] leading-none font-medium text-primary hover:border-primary disabled:cursor-not-allowed disabled:opacity-45';

/**
 * A patient's files (feature 8 §2): the record's Files tab, and — in a dialog over a visit — the
 * workspace's "All files". A header with **Upload** and **Select**; a filter bar (category
 * chips, type, tooth, visit, Show archived, a search over note and filename); then the gallery,
 * square tiles grouped by when they were taken under sticky headers. A tile opens the viewer on
 * the list as filtered; its ⋯ menu opens, downloads, edits or archives it. **Select** turns the
 * tiles into checkboxes with a bar of bulk actions, **Compare** among them for exactly two
 * images. Without `file:write` nothing here uploads or edits.
 */
export function FilesGallery({
  patient,
  tenant,
  visit,
  openFileId,
  onFileOpened,
}: {
  patient: Patient;
  tenant: Tenant;
  /** In a visit: uploads from here are linked to it. */
  visit?: VisitOption | null | undefined;
  /** A file to open in the viewer on arrival (`?file=`, the Activity screen's link). */
  openFileId?: string | undefined;
  onFileOpened?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation('files');
  const locale = i18n.resolvedLanguage ?? 'en';
  const text = useFileText();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { openUpload, openViewer } = useFiles();
  const archiving = useArchiveFiles();
  const files = useQuery(patientFilesQuery(patient.id));
  const canWrite = usePermission('file:write') && patient.mergedIntoId === null;
  const [filter, setFilter] = useState<GalleryFilter>(NO_FILTER);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const today = todayIn(tenant.timeZone);

  const all = files.data ?? [];
  const shown = filterFiles(all, filter);
  const groups = groupByTaken(shown, today, tenant.timeZone);
  const chosen = shown.filter((file) => selected.has(file.id));
  const visits = linkedVisits(all);
  const types =
    filter.category in FILE_SUB_CATEGORIES
      ? FILE_SUB_CATEGORIES[filter.category as FileCategory]
      : [];

  const set = (patch: Partial<GalleryFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
  };
  const upload = () => {
    openUpload({ patientId: patient.id, visit });
  };
  const open = (file: PatientFile, details = false) => {
    openViewer({
      patientId: patient.id,
      ids: shown.map((entry) => entry.id),
      startId: file.id,
      details,
    });
  };
  const download = (list: readonly PatientFile[]) => {
    Promise.all(list.map((file) => downloadFile(file.id))).catch((error: unknown) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    });
  };
  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const patchChosen = async (patch: { category?: FileCategory; toothCode?: ToothCode | null }) => {
    try {
      applyFiles(queryClient, await updateFiles({ ids: chosen.map((file) => file.id), patch }));
      void invalidateFiles(queryClient, patient.id);
      toast(t('gallery.bulk.updated', { count: chosen.length }), { tone: 'success' });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    }
  };

  // `?file=`: the viewer on that file, once the list is in; the parameter then leaves the URL.
  const openArrival = useEffectEvent((id: string) => {
    const file = all.find((entry) => entry.id === id);
    if (file) {
      openViewer({
        patientId: patient.id,
        ids: all.filter((entry) => !isArchived(entry) || entry.id === id).map((entry) => entry.id),
        startId: id,
      });
    }
    onFileOpened?.();
  });
  const loaded = files.data !== undefined;
  useEffect(() => {
    if (loaded && openFileId !== undefined) openArrival(openFileId);
  }, [loaded, openFileId]);

  const groupLabel = (group: TakenGroup) =>
    group.kind === 'month'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
          Date.UTC(group.year, group.month - 1, 1),
        )
      : t(`gallery.groups.${group.kind}`);

  const comparable =
    chosen.length === 2 && chosen.every((file) => file.kind === 'image' && file.viewUrl !== null);

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="me-auto min-w-0">
          <h2 className="m-0 text-[16px] leading-tight font-semibold tracking-[-0.01em]">
            {t('title')}
          </h2>
          <p className="m-0 mt-1 text-[12.5px] leading-none text-ink-muted">{t('subtitle')}</p>
        </div>
        {all.length > 0 && (
          <Button
            aria-pressed={selecting}
            onClick={() => {
              if (selecting) leaveSelection();
              else setSelecting(true);
            }}
          >
            {selecting ? t('gallery.selectDone') : t('gallery.select')}
          </Button>
        )}
        {canWrite && (
          <Button variant="primary" onClick={upload}>
            {t('upload')}
          </Button>
        )}
      </div>

      {all.length > 0 && (
        <div
          role="group"
          aria-label={t('gallery.filters.label')}
          className="mb-4 flex flex-col gap-2.5"
        >
          <div
            role="group"
            aria-label={t('gallery.filters.category')}
            className="flex flex-wrap gap-1.5"
          >
            {CATEGORY_FILTERS.map((category) => {
              const on = filter.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    set({ category, subCategory: '' });
                  }}
                  className={cn(
                    'h-[30px] cursor-pointer rounded-[15px] border px-3 text-[12.5px] leading-none font-medium',
                    on
                      ? 'border-ink bg-ink text-white'
                      : 'border-border-control bg-surface text-ink-secondary hover:border-ink hover:text-ink',
                  )}
                >
                  {category === 'all' || category === 'documents'
                    ? t(`gallery.filters.${category}`)
                    : t(`category.${category}`)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={filter.q}
              onChange={(q) => {
                set({ q });
              }}
              placeholder={t('gallery.filters.searchPlaceholder')}
              label={t('gallery.filters.search')}
              maxLength={100}
            />
            {types.length > 0 && (
              <FilterChip
                label={t('gallery.filters.type')}
                value={filter.subCategory}
                options={[
                  { value: '', label: t('gallery.filters.any') },
                  ...types.map((type) => ({ value: type, label: t(`subCategory.${type}`) })),
                ]}
                onChange={(subCategory) => {
                  set({ subCategory });
                }}
              />
            )}
            <span className="flex h-9 items-center gap-2 rounded-lg border border-border-control bg-surface ps-[11px] pe-1.5">
              <span className="text-[12.5px] leading-none text-ink-muted">
                {t('gallery.filters.tooth')}
              </span>
              <ToothField
                label={t('gallery.filters.tooth')}
                value={filter.toothCode}
                onChange={(toothCode) => {
                  set({ toothCode });
                }}
              />
            </span>
            {visits.length > 0 && (
              <FilterChip
                label={t('gallery.filters.visit')}
                value={filter.visitId}
                options={[
                  { value: '', label: t('gallery.filters.any') },
                  ...visits.map((entry) => ({
                    value: entry.id,
                    label: t('visitField.option', {
                      number: formatVisitNumber(entry.displayNumber),
                      date: formatCalendarDate(entry.localDate, locale),
                    }),
                  })),
                ]}
                onChange={(visitId) => {
                  set({ visitId });
                }}
              />
            )}
            <label className="flex h-9 cursor-pointer items-center gap-2 text-[12.5px] leading-none font-medium text-ink-secondary">
              <Switch
                checked={filter.showArchived}
                onCheckedChange={(showArchived) => {
                  set({ showArchived });
                }}
                label={t('gallery.filters.showArchived')}
              />
              <span aria-hidden>{t('gallery.filters.showArchived')}</span>
            </label>
            {isFiltered(filter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilter(NO_FILTER);
                }}
              >
                {t('gallery.filters.clear')}
              </Button>
            )}
          </div>
        </div>
      )}

      {files.data === undefined ? (
        files.isError ? (
          <p role="alert" className="m-0 text-[12.5px] text-ink-muted">
            {t('failed')}
          </p>
        ) : (
          <CardSkeleton label={t('loading')} />
        )
      ) : all.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            title={t('gallery.empty.title')}
            body={canWrite ? t('gallery.empty.body') : t('gallery.empty.readOnly')}
            action={
              canWrite ? (
                <Button variant="primary" onClick={upload}>
                  {t('upload')}
                </Button>
              ) : undefined
            }
          />
        </section>
      ) : shown.length === 0 ? (
        <section className="rounded-xl border border-border bg-surface">
          <EmptyState
            title={t('gallery.noMatch.title')}
            body={t('gallery.noMatch.body')}
            action={
              <Button
                onClick={() => {
                  setFilter(NO_FILTER);
                }}
              >
                {t('gallery.filters.clear')}
              </Button>
            }
          />
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-label={groupLabel(group.group)} className="mb-5">
            <h3 className="sticky top-0 z-[1] m-0 mb-2 bg-background py-1.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
              {groupLabel(group.group)}
            </h3>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
              {group.files.map((file) => {
                const on = selected.has(file.id);
                return (
                  <li key={file.id}>
                    <FileTile
                      file={file}
                      size="fill"
                      onOpen={() => {
                        if (!selecting) {
                          open(file);
                          return;
                        }
                        setSelected((current) => {
                          const next = new Set(current);
                          if (!next.delete(file.id)) next.add(file.id);
                          return next;
                        });
                      }}
                    >
                      {selecting ? (
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={t('gallery.selectFile', { name: file.originalFilename })}
                          onChange={() => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (!next.delete(file.id)) next.add(file.id);
                              return next;
                            });
                          }}
                          className="absolute end-2 top-2 size-[18px] cursor-pointer accent-primary"
                        />
                      ) : (
                        <Menu>
                          <MenuTrigger asChild>
                            <IconButton
                              aria-label={t('gallery.menu.label', { name: file.originalFilename })}
                              className="absolute end-1.5 top-1.5 size-7 border-border bg-surface opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
                            >
                              <svg
                                aria-hidden
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <circle cx="3" cy="8" r="1.4" />
                                <circle cx="8" cy="8" r="1.4" />
                                <circle cx="13" cy="8" r="1.4" />
                              </svg>
                            </IconButton>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem
                              onSelect={() => {
                                open(file);
                              }}
                            >
                              {t('gallery.menu.open')}
                            </MenuItem>
                            <MenuItem
                              onSelect={() => {
                                download([file]);
                              }}
                            >
                              {t('gallery.menu.download')}
                            </MenuItem>
                            {canWrite && (
                              <MenuItem
                                onSelect={() => {
                                  open(file, true);
                                }}
                              >
                                {t('gallery.menu.edit')}
                              </MenuItem>
                            )}
                            {archiving.canArchive(file) && (
                              <MenuItem
                                tone="danger"
                                onSelect={() => {
                                  archiving.archive([file]);
                                }}
                              >
                                {t('gallery.menu.archive')}
                              </MenuItem>
                            )}
                            {archiving.canRestore(file) && (
                              <MenuItem onSelect={() => void archiving.restore([file])}>
                                {t('gallery.menu.restore')}
                              </MenuItem>
                            )}
                          </MenuContent>
                        </Menu>
                      )}
                    </FileTile>
                    <p className="m-0 mt-1.5 truncate text-[11.5px] leading-[1.3] text-ink-muted">
                      {text.summary({ ...file, toothCode: null }) || file.originalFilename}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {all.length >= LIST_LIMIT && (
        <p className="m-0 text-[12.5px] leading-snug text-ink-muted">{t('gallery.capped')}</p>
      )}

      {selecting && chosen.length > 0 && (
        <div
          role="toolbar"
          aria-label={t('gallery.bulk.label')}
          className="sticky bottom-3 z-[2] mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-primary-tint-border bg-primary-tint px-3 py-2 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
        >
          <span className="me-1.5 text-[12.5px] leading-none font-semibold text-primary">
            {t('gallery.bulk.selected', { count: chosen.length })}
          </span>
          {canWrite && (
            <>
              <Menu>
                <MenuTrigger asChild>
                  <button type="button" className={BULK_BUTTON}>
                    {t('gallery.bulk.setCategory')}
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  {FILE_CATEGORIES.map((category) => (
                    <MenuItem key={category} onSelect={() => void patchChosen({ category })}>
                      {t(`category.${category}`)}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button type="button" className={BULK_BUTTON}>
                    {t('gallery.bulk.setTooth')}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={6}
                    aria-label={t('gallery.bulk.setTooth')}
                    className="z-50 flex animate-fadein items-center gap-2 rounded-[10px] border border-border bg-surface p-3 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
                  >
                    <ToothField
                      label={t('fields.tooth')}
                      value={null}
                      onChange={(toothCode) => void patchChosen({ toothCode })}
                    />
                    <Popover.Close asChild>
                      <Button size="sm" onClick={() => void patchChosen({ toothCode: null })}>
                        {t('toothField.none')}
                      </Button>
                    </Popover.Close>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </>
          )}
          <button
            type="button"
            className={BULK_BUTTON}
            onClick={() => {
              download(chosen);
            }}
          >
            {t('gallery.bulk.download')}
          </button>
          {comparable && (
            <button
              type="button"
              className={BULK_BUTTON}
              onClick={() => {
                openViewer({
                  patientId: patient.id,
                  // The older one first: before, then after.
                  ids: [...chosen]
                    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
                    .map((file) => file.id),
                  compare: true,
                });
              }}
            >
              {t('gallery.bulk.compare')}
            </button>
          )}
          {chosen.every((file) => archiving.canArchive(file)) && (
            <button
              type="button"
              className={cn(BULK_BUTTON, 'text-danger hover:border-danger')}
              onClick={() => {
                archiving.archive(chosen, leaveSelection);
              }}
            >
              {t('gallery.bulk.archive')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
