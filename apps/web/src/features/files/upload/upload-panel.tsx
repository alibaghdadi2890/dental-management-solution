import { ACCEPTED_UPLOADS, type FileCategory, type Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { patientQuery } from '@/features/patients/patients-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFileText } from '../file-text';
import { applyFiles, invalidateFiles, saveFiles } from '../files-api';
import type { UploadRequest, ViewerRequest } from '../files-context';
import { CategoryChips, TypeChips, VisitField } from '../meta-fields';
import { lastCategory, rememberCategory } from '../session-memory';
import { ToothField } from '../tooth-field';
import type { VisitOption } from '../visit-options';
import {
  type Batch,
  batchStatus,
  EMPTY_META,
  type FileMeta,
  hasWork,
  isEdited,
  metaOf,
  saveItems,
  type Tile,
} from './upload-batch';
import { useUploader } from './use-uploader';

type Tenant = NonNullable<Session['tenant']>;

const NOTE_MAX = 2000;
const CATEGORY_KEYS: Record<string, FileCategory> = { '1': 'xray', '2': 'photo', '3': 'other' };
const LABEL = 'mb-1.5 block text-[12.5px] leading-none font-medium';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

/** `IMG_20260312_104…_final.jpg`: a long name cut in the middle, where it says the least. */
function middle(name: string, max = 34): string {
  if (name.length <= max) return name;
  const tail = Math.floor((max - 1) / 2);
  return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
}

/**
 * What the panel opens with (F3, F5): the tooth and the visit the context knows, and — when
 * every dropped file is an image — the category and type of the last upload of this session.
 */
function initialBatch(request: UploadRequest): { batch: Batch; remembered: boolean } {
  const last = lastCategory();
  const images = (request.files ?? []).every(
    (file) =>
      file.type.startsWith('image/') || /\.(jpe?g|png|webp|hei[cf]|tiff?)$/i.test(file.name),
  );
  const remembered = last !== null && images;
  return {
    remembered,
    batch: {
      header: {
        ...EMPTY_META,
        ...(remembered ? last : {}),
        toothCode: request.toothCode ?? null,
        visitId: request.visit?.id ?? null,
      },
      tiles: [],
    },
  };
}

/**
 * The "Add files" right panel (feature 8 §1): the one upload flow, opened by a drop, a click or
 * a paste. A drop zone that stays for a second drop, the metadata every file will be saved with
 * ("Apply to all" once there are several), then a tile per file with its own progress, and Save.
 * Category is the only thing that must be chosen; the rest is optional and pre-filled from where
 * the panel was opened. It floats over the screen — and over a dialog it was opened from — with
 * a scrim; Escape, the scrim and Cancel close it, after a "Discard n files?" prompt when
 * uploads would be thrown away.
 */
export function UploadPanel({
  request,
  tenant,
  onClose,
  onView,
}: {
  request: UploadRequest;
  tenant: Tenant;
  onClose: () => void;
  /** The saved toast's **View**. */
  onView: (viewer: ViewerRequest) => void;
}) {
  const { t, i18n } = useTranslation(['files', 'common']);
  const text = useFileText();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const patient = useQuery(patientQuery(request.patientId));
  const [initial] = useState(() => initialBatch(request));
  const uploader = useUploader(request.patientId, initial.batch);
  const { batch } = uploader;
  const status = batchStatus(batch);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [openTile, setOpenTile] = useState<string | null>(null);
  // The visit the panel can name without a lookup: the pre-filled one, then any chosen since.
  const [knownVisit, setKnownVisit] = useState<VisitOption | null>(request.visit ?? null);
  const browseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const categoryId = useId();
  const typeId = useId();
  const noteId = useId();
  const today = todayIn(tenant.timeZone);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  const { add } = uploader;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    add(request.files ?? []);
  }, [add, request.files]);

  // While the panel is open every drop and every pasted image joins the batch (F2, F6).
  const onDrop = useEffectEvent((event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (!saving) add([...event.dataTransfer.files]);
  });
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length === 0 || saving) return;
    event.preventDefault();
    add(files);
  });
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  const setHeader = (patch: Partial<FileMeta>) => {
    setTouched(true);
    setError(null);
    uploader.setHeader(patch);
  };

  const close = () => {
    if (saving) return;
    if (!hasWork(batch)) {
      uploader.discardAll();
      onClose();
      return;
    }
    confirm({
      title: t('panel.discardTitle', { count: status.ready.length + status.uploading }),
      body: t('panel.discardBody'),
      okLabel: t('panel.discardOk'),
      cancelLabel: t('panel.keep'),
      tone: 'warn',
      onConfirm: () => {
        uploader.discardAll();
        onClose();
      },
    });
  };

  const save = async () => {
    if (!status.canSave || saving) return;
    const files = saveItems(batch);
    setSaving(true);
    setError(null);
    try {
      const saved = await saveFiles({ patientId: request.patientId, files });
      applyFiles(queryClient, saved);
      void invalidateFiles(queryClient, request.patientId);
      // What "Apply to all" said, else the first file's own.
      const [first] = files;
      const { category, subCategory } = batch.header;
      if (category) rememberCategory({ category, subCategory });
      else if (first) {
        rememberCategory({ category: first.category, subCategory: first.subCategory ?? null });
      }
      const ids = saved.items.map((file) => file.id);
      toast(t('panel.saved', { count: ids.length }), {
        tone: 'success',
        actionLabel: t('panel.view'),
        onAction: () => {
          onView({ patientId: request.patientId, ids, startId: ids[0] });
        },
      });
      onClose();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      // Enter on a button presses it, in a textarea breaks the line, in a select picks.
      const target = event.target;
      if (
        target instanceof HTMLButtonElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      void save();
    }
  };

  const several = batch.tiles.filter((tile) => tile.status !== 'refused').length > 1;
  const picked = (files: FileList | null) => {
    if (files) add([...files]);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        {/* A dialog layer of its own, so it works over the dialogs it is opened from (the
            post-visit summary, a visit's All files). The panel inside manages its focus. */}
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          className="fixed inset-0 z-50 outline-none"
        >
          <div
            aria-hidden
            onClick={close}
            className="absolute inset-0 animate-fadein bg-[rgba(27,26,31,.28)]"
          />
          <Dialog.Title className="sr-only">{t('panel.title')}</Dialog.Title>
          <RightPanel
            title={t('panel.title')}
            subtitle={
              patient.data && (
                <p className="m-0 mt-[3px] text-[12.5px] leading-[1.4] text-ink-muted">
                  {patient.data.fullName}
                  {t('separator')}
                  <span dir="ltr" className="font-mono">
                    {patient.data.displayNumber}
                  </span>
                </p>
              )
            }
            dirty={false}
            onClose={close}
            closeDisabled={saving}
            className="absolute inset-y-0 end-0 max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
            bodyClassName="p-0 gap-0"
          >
            <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-[18px]">
                <div className="flex min-h-[120px] flex-none flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-border-strong bg-faint px-4 py-5 text-center">
                  <svg
                    aria-hidden
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="text-ink-muted"
                  >
                    <path d="M12 16V5m0 0-4 4m4-4 4 4M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
                  </svg>
                  {touch ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={() => {
                          cameraRef.current?.click();
                        }}
                      >
                        {t('panel.takePhoto')}
                      </Button>
                      <Button
                        onClick={() => {
                          browseRef.current?.click();
                        }}
                      >
                        {t('panel.chooseFiles')}
                      </Button>
                    </div>
                  ) : (
                    <p className="m-0 text-[13px] leading-[1.45] text-ink-secondary">
                      {batch.tiles.length > 0 ? t('panel.dropMore') : t('panel.dropFirst')}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          browseRef.current?.click();
                        }}
                        className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-primary underline"
                      >
                        {t('panel.browse')}
                      </button>
                    </p>
                  )}
                  <p className="m-0 text-[11.5px] leading-none text-ink-muted">{t('drop.hint')}</p>
                  <input
                    ref={browseRef}
                    type="file"
                    multiple
                    hidden
                    accept={ACCEPTED_UPLOADS}
                    aria-label={t('panel.chooseFiles')}
                    onChange={(event) => {
                      picked(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <input
                    ref={cameraRef}
                    type="file"
                    hidden
                    accept="image/*"
                    capture="environment"
                    aria-label={t('panel.takePhoto')}
                    onChange={(event) => {
                      picked(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </div>

                <section
                  aria-label={several ? t('panel.applyToAll') : t('fields.category')}
                  onKeyDown={(event) => {
                    const category = CATEGORY_KEYS[event.key];
                    if (!category || isTyping(event.target)) return;
                    event.preventDefault();
                    setHeader({ category });
                  }}
                  className="flex flex-col gap-3.5"
                >
                  {several && (
                    <h3 className="m-0 text-[11.5px] leading-none font-medium tracking-[0.06em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
                      {t('panel.applyToAll')}
                    </h3>
                  )}
                  <div>
                    <span id={categoryId} className={LABEL}>
                      {t('fields.category')}
                    </span>
                    <CategoryChips
                      size="lg"
                      labelledBy={categoryId}
                      value={batch.header.category}
                      onChange={(category) => {
                        setHeader({ category });
                      }}
                    />
                    {initial.remembered && !touched && (
                      <p className="m-0 mt-1.5 text-[12px] leading-snug text-ink-muted">
                        {t('panel.sameAsLast')}
                      </p>
                    )}
                  </div>
                  {batch.header.category !== null && batch.header.category !== 'other' && (
                    <div>
                      <span id={typeId} className={LABEL}>
                        {t('fields.type')}
                      </span>
                      <TypeChips
                        labelledBy={typeId}
                        category={batch.header.category}
                        value={batch.header.subCategory}
                        onChange={(subCategory) => {
                          setHeader({ subCategory });
                        }}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <div>
                      <span className={LABEL}>{t('fields.tooth')}</span>
                      <ToothField
                        label={t('fields.tooth')}
                        value={batch.header.toothCode}
                        onChange={(toothCode) => {
                          setHeader({ toothCode });
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <span className={LABEL}>{t('fields.visit')}</span>
                      <VisitField
                        patientId={request.patientId}
                        value={batch.header.visitId}
                        known={knownVisit}
                        today={today}
                        onChange={(visit) => {
                          if (visit) setKnownVisit(visit);
                          setHeader({ visitId: visit?.id ?? null });
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={noteId} className={LABEL}>
                      {t('fields.note')}
                    </label>
                    <input
                      id={noteId}
                      value={batch.header.note}
                      maxLength={NOTE_MAX}
                      placeholder={t('panel.notePlaceholder')}
                      onChange={(event) => {
                        setHeader({ note: event.target.value });
                      }}
                      className="h-9 w-full rounded-lg border border-border-control bg-surface px-[11px] text-[13px] leading-none text-ink"
                    />
                  </div>
                </section>

                {batch.tiles.length > 0 && (
                  <ul
                    aria-label={t('panel.files')}
                    className="m-0 flex list-none flex-col gap-2 p-0"
                  >
                    {batch.tiles.map((tile) => (
                      <UploadTile
                        key={tile.key}
                        tile={tile}
                        meta={metaOf(batch, tile)}
                        edited={isEdited(batch, tile)}
                        editable={several}
                        open={openTile === tile.key}
                        onToggle={() => {
                          setOpenTile((current) => (current === tile.key ? null : tile.key));
                        }}
                        onMeta={(patch) => {
                          setError(null);
                          uploader.setTile(tile.key, patch);
                        }}
                        onRetry={() => {
                          uploader.retry(tile.key);
                        }}
                        onRemove={() => {
                          uploader.remove(tile.key);
                        }}
                        patientId={request.patientId}
                        knownVisit={knownVisit}
                        onVisitKnown={setKnownVisit}
                        today={today}
                        size={text.size(tile.file.size)}
                        summary={text.summary(metaOf(batch, tile))}
                      />
                    ))}
                  </ul>
                )}

                {error && (
                  <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex flex-none flex-wrap items-center gap-2 border-t border-inner-divider px-[18px] py-3">
                <div className="me-auto min-w-0 text-[12px] leading-[1.4] text-ink-muted">
                  {batch.tiles.length > 0 && (
                    <span>
                      {t('count', { count: batch.tiles.length })}
                      {t('separator')}
                      <span className="font-mono">{text.size(status.totalBytes)}</span>
                    </span>
                  )}
                  {status.uncategorised > 0 && status.uploading === 0 && (
                    <span role="status" className="block font-medium text-warning">
                      {t('panel.chooseCategory')}
                    </span>
                  )}
                </div>
                <Button variant="secondary" disabled={saving} onClick={close}>
                  {t('common:cancel')}
                </Button>
                <Button
                  variant="primary"
                  disabled={!status.canSave}
                  busy={saving}
                  onClick={() => void save()}
                >
                  {status.ready.length === 0
                    ? t('panel.saveNone')
                    : t('panel.save', { count: status.ready.length })}
                </Button>
              </div>
            </div>
          </RightPanel>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UploadTile({
  tile,
  meta,
  edited,
  editable,
  open,
  onToggle,
  onMeta,
  onRetry,
  onRemove,
  patientId,
  knownVisit,
  onVisitKnown,
  today,
  size,
  summary,
}: {
  tile: Tile;
  meta: FileMeta;
  edited: boolean;
  /** Several files: each can differ from the header. With one, the header is the file. */
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  onMeta: (patch: Partial<FileMeta>) => void;
  onRetry: () => void;
  onRemove: () => void;
  patientId: string;
  knownVisit: VisitOption | null;
  onVisitKnown: (visit: VisitOption) => void;
  today: string;
  size: string;
  summary: string;
}) {
  const { t } = useTranslation('files');
  const categoryId = useId();
  const typeId = useId();
  const noteId = useId();
  const name = tile.file.name;
  const percent = Math.round(tile.progress * 100);

  return (
    <li className="rounded-[10px] border border-border bg-surface">
      <div className="flex items-start gap-3 p-2.5">
        <span className="grid size-16 flex-none place-items-center overflow-hidden rounded-lg border border-border bg-faint">
          {tile.previewUrl ? (
            <img src={tile.previewUrl} alt="" className="size-full object-cover" />
          ) : (
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              className="text-ink-muted"
            >
              <path d="M4 2h5.5l3 3v9H4z" />
              <path d="M9.5 2v3h3" />
            </svg>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              dir="auto"
              title={name}
              className="min-w-0 truncate text-[13px] leading-[1.35] font-medium"
            >
              {middle(name)}
            </span>
            <span className="flex-none font-mono text-[11.5px] leading-none text-ink-muted">
              {size}
            </span>
          </div>
          {tile.status === 'uploading' && (
            <div className="mt-2">
              <div
                role="progressbar"
                aria-label={name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1 overflow-hidden rounded-full bg-inner-divider"
              >
                <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
              <span className="mt-1 block text-[11.5px] leading-none text-ink-muted">
                {t('panel.uploading', { percent })}
              </span>
            </div>
          )}
          {tile.status === 'uploaded' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.35]">
              <span className={meta.category === null ? 'text-warning' : 'text-ink-secondary'}>
                {meta.category === null ? t('panel.noCategory') : summary}
              </span>
              {edited && (
                <span className="inline-flex items-center gap-1 text-ink-muted">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning-dot" />
                  {t('panel.edited')}
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={open ? undefined : t('panel.editFile', { name })}
                  onClick={onToggle}
                  className="cursor-pointer border-0 bg-transparent p-0 font-medium text-primary hover:underline"
                >
                  {open ? t('panel.done') : t('panel.edit')}
                </button>
              )}
            </div>
          )}
          {tile.status === 'failed' && (
            <p
              role="alert"
              className="m-0 mt-1.5 flex flex-wrap items-center gap-2 text-[12px] leading-[1.35] font-medium text-danger"
            >
              {t('panel.uploadFailed')}
              <button
                type="button"
                onClick={onRetry}
                className="h-[24px] cursor-pointer rounded-md border border-border-control bg-surface px-2 text-[12px] leading-none font-medium text-ink hover:border-primary hover:text-primary"
              >
                {t('panel.retry')}
              </button>
            </p>
          )}
          {tile.status === 'refused' && tile.refusal && (
            <p
              role="alert"
              className="m-0 mt-1.5 text-[12px] leading-[1.35] font-medium text-danger"
            >
              {t(`panel.refused.${tile.refusal}`)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t('panel.removeFile', { name })}
          title={t('panel.remove')}
          onClick={onRemove}
          className="grid size-[26px] flex-none cursor-pointer place-items-center rounded-md border border-transparent bg-transparent text-ink-muted hover:border-border hover:bg-faint hover:text-ink"
        >
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="m2 2 6 6M8 2 2 8" />
          </svg>
        </button>
      </div>
      {open && editable && tile.status === 'uploaded' && (
        <div className="flex flex-col gap-3 border-t border-inner-divider bg-sunken p-3">
          <div>
            <span id={categoryId} className={LABEL}>
              {t('fields.category')}
            </span>
            <CategoryChips
              labelledBy={categoryId}
              value={meta.category}
              onChange={(category) => {
                onMeta({ category });
              }}
            />
          </div>
          {meta.category !== null && meta.category !== 'other' && (
            <div>
              <span id={typeId} className={LABEL}>
                {t('fields.type')}
              </span>
              <TypeChips
                labelledBy={typeId}
                category={meta.category}
                value={meta.subCategory}
                onChange={(subCategory) => {
                  onMeta({ subCategory });
                }}
              />
            </div>
          )}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div>
              <span className={LABEL}>{t('fields.tooth')}</span>
              <ToothField
                label={t('fields.tooth')}
                value={meta.toothCode}
                onChange={(toothCode) => {
                  onMeta({ toothCode });
                }}
              />
            </div>
            <div className="min-w-0">
              <span className={LABEL}>{t('fields.visit')}</span>
              <VisitField
                patientId={patientId}
                value={meta.visitId}
                known={knownVisit}
                today={today}
                onChange={(visit) => {
                  if (visit) onVisitKnown(visit);
                  onMeta({ visitId: visit?.id ?? null });
                }}
              />
            </div>
          </div>
          <div>
            <label htmlFor={noteId} className={LABEL}>
              {t('fields.note')}
            </label>
            <input
              id={noteId}
              value={meta.note}
              maxLength={NOTE_MAX}
              onChange={(event) => {
                onMeta({ note: event.target.value });
              }}
              className={cn(
                'h-9 w-full rounded-lg border border-border-control bg-surface px-[11px] text-[13px] leading-none text-ink',
              )}
            />
          </div>
        </div>
      )}
    </li>
  );
}
