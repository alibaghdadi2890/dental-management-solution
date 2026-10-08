import type { FileOrientation, PatientFile, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, Popover } from 'radix-ui';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepOpenForToast, useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { patientQuery } from '@/features/patients/patients-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { cn } from '@/lib/utils';
import { FileThumb } from '../file-tile';
import { glyphOf, useFileText } from '../file-text';
import {
  applyFiles,
  downloadFile,
  invalidateFiles,
  patientFilesQuery,
  updateFiles,
} from '../files-api';
import type { ViewerRequest } from '../files-context';
import { addRotation, rotateClockwise } from '../rotation';
import { useArchiveFiles } from '../use-archive-files';
import { CompareView } from './compare-view';
import { DetailsPanel } from './details-panel';
import { ImageStage } from './stage';
import { type ImageFilters, NO_FILTERS, type StageHandle } from './stage-types';
import { ViewerButton, ViewerIcon } from './viewer-button';

type Tenant = NonNullable<Session['tenant']>;

const SHORTCUTS = [
  ['← →', 'navigate'],
  ['+ −', 'zoom'],
  ['0 1', 'fit'],
  ['R', 'rotate'],
  ['F', 'fullscreen'],
  ['I', 'details'],
  ['T', 'filmstrip'],
  ['?', 'help'],
  ['Esc', 'close'],
] as const;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

/**
 * The full-screen viewer (feature 8 §4), the same wherever a thumbnail is opened: a dark stage
 * with the image fitted to it — zoom, pan, rotate, the X-ray reading aids — or the document
 * inline; a top bar that says what the file is and holds the actions; a filmstrip of the list it
 * was opened from; and the Details panel. It steps through that list with the arrows (mirrored
 * right-to-left), the chevrons or a swipe, wrapping at the ends with a soft bump. A modal: the
 * page behind is locked, focus is trapped, `Esc` closes it and focus returns to what opened it.
 */
export function FileViewer({
  request,
  tenant,
  onClose,
}: {
  request: ViewerRequest;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t } = useTranslation('files');
  const files = useQuery(patientFilesQuery(request.patientId));
  // Archived from here: the file leaves the list being viewed, whatever the gallery shows.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const byId = new Map((files.data ?? []).map((file) => [file.id, file]));
  const list = request.ids.flatMap((id) => {
    const file = byId.get(id);
    return file && !removed.has(id) ? [file] : [];
  });
  const empty = files.data !== undefined && list.length === 0;
  useEffect(() => {
    if (empty) onClose();
  }, [empty, onClose]);

  // Side by side (the gallery's Compare): exactly two images the viewer can draw.
  const [first, second] = list;
  const pair =
    request.compare === true &&
    list.length === 2 &&
    first?.kind === 'image' &&
    second?.kind === 'image' &&
    first.viewUrl !== null &&
    second.viewUrl !== null
      ? ([first, second] as const)
      : null;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[#0f0e12]" />
        <Dialog.Content
          aria-describedby={undefined}
          // A field being typed in saves when focus leaves it: Esc must not skip that.
          onEscapeKeyDown={() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
          onPointerDownOutside={keepOpenForToast}
          onInteractOutside={keepOpenForToast}
          className="fixed inset-0 z-50 flex flex-col bg-[#0f0e12] text-white outline-none"
        >
          {list.length === 0 ? (
            <>
              <Dialog.Title className="sr-only">{t('viewer.label')}</Dialog.Title>
              <p aria-busy={files.isPending} className="m-auto text-[13px] text-white/60">
                {files.isError ? t('failed') : t('loading')}
              </p>
            </>
          ) : pair ? (
            <CompareView first={pair[0]} second={pair[1]} onClose={onClose} />
          ) : (
            <Viewer
              list={list}
              startId={request.startId}
              detailsOpen={request.details === true}
              tenant={tenant}
              onClose={onClose}
              onRemoved={(id) => {
                setRemoved((current) => new Set(current).add(id));
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Viewer({
  list,
  startId,
  detailsOpen,
  tenant,
  onClose,
  onRemoved,
}: {
  list: PatientFile[];
  startId: string | undefined;
  detailsOpen: boolean;
  tenant: Tenant;
  onClose: () => void;
  onRemoved: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('files');
  const text = useFileText();
  const toothLabel = useToothLabel();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('file:write');
  const archiving = useArchiveFiles();
  const rtl = i18n.dir() === 'rtl';

  const [currentId, setCurrentId] = useState(startId ?? list[0]?.id);
  const found = list.findIndex((file) => file.id === currentId);
  const index = found < 0 ? 0 : found;
  const file = list[index];
  const patient = useQuery({ ...patientQuery(file?.patientId ?? ''), enabled: file !== undefined });

  // What is only looked through — the turns not saved yet, the reading aids — starts afresh on
  // every file.
  const [turned, setTurned] = useState<FileOrientation>(0);
  const [filters, setFilters] = useState<ImageFilters>(NO_FILTERS);
  const [percent, setPercent] = useState<number | null>(null);
  const [shownId, setShownId] = useState(file?.id);
  if (shownId !== file?.id) {
    setShownId(file?.id);
    setTurned(0);
    setFilters(NO_FILTERS);
    setPercent(null);
  }

  const [details, setDetails] = useState(detailsOpen);
  const [filmstrip, setFilmstrip] = useState(true);
  const [help, setHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [bump, setBump] = useState(0);
  const [savingTurn, setSavingTurn] = useState(false);
  const stage = useRef<StageHandle>(null);
  const currentThumb = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  useEffect(() => {
    currentThumb.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [index]);

  if (!file) return null;
  const image = file.kind === 'image' && file.viewUrl !== null;
  const orientation = addRotation(file.orientation, turned);

  const step = (by: -1 | 1) => {
    if (list.length < 2) return;
    const next = index + by;
    // Past an end: round to the other one, with a bump instead of an error.
    if (next < 0 || next >= list.length) setBump((count) => count + 1);
    setCurrentId(list[(next + list.length) % list.length]?.id);
  };

  const toggleFullscreen = () => {
    // The whole page, not the viewer alone: confirms, popovers and toasts are portalled beside
    // it and would not show inside a full-screen element of its own.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const saveOrientation = async () => {
    setSavingTurn(true);
    try {
      applyFiles(queryClient, await updateFiles({ ids: [file.id], patch: { orientation } }));
      void invalidateFiles(queryClient, file.patientId);
      setTurned(0);
      toast(t('viewer.orientationSaved'), { tone: 'success' });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    }
    setSavingTurn(false);
  };

  const download = () => {
    downloadFile(file.id).catch((error: unknown) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    });
  };

  const archive = () => {
    archiving.archive([file], () => {
      // On to the next file; the viewer closes itself once its list is empty.
      const next = list[index + 1] ?? list[index - 1];
      setCurrentId(next?.id);
      onRemoved(file.id);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const actions: Record<string, (() => void) | undefined> = {
      ArrowLeft: () => {
        step(rtl ? 1 : -1);
      },
      ArrowRight: () => {
        step(rtl ? -1 : 1);
      },
      '+': image ? () => stage.current?.zoomIn() : undefined,
      '=': image ? () => stage.current?.zoomIn() : undefined,
      '-': image ? () => stage.current?.zoomOut() : undefined,
      '0': image ? () => stage.current?.fit() : undefined,
      '1': image ? () => stage.current?.actual() : undefined,
      r: image
        ? () => {
            setTurned(rotateClockwise);
          }
        : undefined,
      f: toggleFullscreen,
      i: () => {
        setDetails((open) => !open);
      },
      t: () => {
        setFilmstrip((open) => !open);
      },
      '?': () => {
        setHelp((open) => !open);
      },
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const summary = text.summary({ ...file, toothCode: null });

  return (
    <div
      // Focusable, so a click on the stage leaves focus inside: the shortcuts keep working.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col bg-[#0f0e12] outline-none"
    >
      <div
        role="toolbar"
        aria-label={file.originalFilename}
        className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/10 px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] leading-[1.3]">
          {/* The dialog keeps one name; the bar says whose file this is. */}
          <Dialog.Title className="sr-only">{t('viewer.label')}</Dialog.Title>
          <p className="m-0 text-[13.5px] leading-[1.3] font-semibold">
            {patient.data?.fullName ?? file.originalFilename}
          </p>
          {summary !== '' && <span className="text-white/75">{summary}</span>}
          {file.toothCode !== null && (
            <span className="rounded-[5px] border border-white/20 bg-white/10 px-1.5 py-[3px] text-[11.5px] leading-none font-medium">
              {t('tooth', { tooth: toothLabel(file.toothCode) })}
            </span>
          )}
          <span className="text-white/60">
            {t('viewer.taken', { date: text.dateTime(file.takenAt) })}
          </span>
          {file.archivedAt !== null && (
            <span className="rounded-[5px] border border-white/20 px-1.5 py-[3px] text-[11.5px] leading-none text-white/75">
              {t('archivedBadge')}
            </span>
          )}
          <span aria-live="polite" className="font-mono text-[12px] text-white/60">
            {t('viewer.position', { index: index + 1, total: list.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {image && (
            <>
              <ViewerButton
                label={t('viewer.invert')}
                pressed={filters.invert}
                onClick={() => {
                  setFilters((current) => ({ ...current, invert: !current.invert }));
                }}
              >
                <ViewerIcon name="invert" />
              </ViewerButton>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <ViewerButton
                    label={t('viewer.adjust')}
                    pressed={filters.brightness !== 1 || filters.contrast !== 1}
                  >
                    <ViewerIcon name="sliders" />
                  </ViewerButton>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={6}
                    aria-label={t('viewer.adjust')}
                    className="z-[70] flex w-[230px] flex-col gap-3 rounded-[10px] border border-white/15 bg-[#24232a] p-3.5 text-white shadow-[0_10px_28px_rgba(0,0,0,.4)]"
                  >
                    {(['brightness', 'contrast'] as const).map((aid) => (
                      <label key={aid} className="block text-[12.5px] leading-none font-medium">
                        {t(`viewer.${aid}`)}
                        <input
                          type="range"
                          min={0.4}
                          max={2.2}
                          step={0.05}
                          value={filters[aid]}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setFilters((current) => ({ ...current, [aid]: value }));
                          }}
                          className="mt-2 block w-full accent-white"
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setFilters((current) => ({ ...current, brightness: 1, contrast: 1 }));
                      }}
                      className="h-7 cursor-pointer self-start rounded-md border border-white/25 bg-transparent px-2.5 text-[12px] leading-none font-medium text-white hover:bg-white/10"
                    >
                      {t('viewer.reset')}
                    </button>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
              <ViewerButton
                label={t('viewer.zoomOut')}
                shortcut="-"
                onClick={() => stage.current?.zoomOut()}
              >
                <ViewerIcon name="minus" />
              </ViewerButton>
              <span
                aria-label={percent === null ? undefined : t('viewer.zoomLabel', { percent })}
                className="min-w-[46px] text-center font-mono text-[12px] leading-none text-white/75"
              >
                {percent === null ? '' : t('viewer.zoom', { percent })}
              </span>
              <ViewerButton
                label={t('viewer.zoomIn')}
                shortcut="+"
                onClick={() => stage.current?.zoomIn()}
              >
                <ViewerIcon name="plus" />
              </ViewerButton>
              <ViewerButton
                label={t('viewer.fit')}
                shortcut="0"
                onClick={() => stage.current?.fit()}
              >
                {t('viewer.fit')}
              </ViewerButton>
              <ViewerButton
                label={t('viewer.actualLabel')}
                shortcut="1"
                onClick={() => stage.current?.actual()}
              >
                <span dir="ltr">{t('viewer.actual')}</span>
              </ViewerButton>
              <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
              <ViewerButton
                label={t('viewer.rotate')}
                shortcut="R"
                onClick={() => {
                  setTurned(rotateClockwise);
                }}
              >
                <ViewerIcon name="rotate" />
              </ViewerButton>
              {turned !== 0 && canWrite && (
                <button
                  type="button"
                  disabled={savingTurn}
                  onClick={() => void saveOrientation()}
                  className="h-8 cursor-pointer rounded-md border border-white bg-white px-2.5 text-[12px] leading-none font-semibold text-ink hover:bg-white/90 disabled:opacity-50"
                >
                  {t('viewer.saveOrientation')}
                </button>
              )}
            </>
          )}
          <ViewerButton
            label={fullscreen ? t('viewer.exitFullscreen') : t('viewer.fullscreen')}
            shortcut="F"
            pressed={fullscreen}
            onClick={toggleFullscreen}
          >
            <ViewerIcon name="fullscreen" />
          </ViewerButton>
          <ViewerButton
            label={t('viewer.details')}
            shortcut="I"
            pressed={details}
            onClick={() => {
              setDetails((open) => !open);
            }}
          >
            <ViewerIcon name="info" />
          </ViewerButton>
          <ViewerButton label={t('viewer.download')} onClick={download}>
            <ViewerIcon name="download" />
          </ViewerButton>
          {archiving.canArchive(file) && (
            <ViewerButton label={t('viewer.archive')} onClick={archive}>
              <ViewerIcon name="archive" />
            </ViewerButton>
          )}
          {archiving.canRestore(file) && (
            <ViewerButton
              label={t('viewer.restore')}
              onClick={() => void archiving.restore([file])}
            >
              <ViewerIcon name="restore" />
            </ViewerButton>
          )}
          <ViewerButton
            label={t('viewer.shortcuts')}
            shortcut="?"
            pressed={help}
            onClick={() => {
              setHelp((open) => !open);
            }}
          >
            <ViewerIcon name="help" />
          </ViewerButton>
          <ViewerButton label={t('viewer.close')} shortcut="Esc" onClick={onClose}>
            <ViewerIcon name="close" />
          </ViewerButton>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="group/stage relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            key={bump}
            className={cn('flex min-h-0 flex-1 flex-col', bump > 0 && 'animate-bump')}
          >
            {image && file.viewUrl !== null ? (
              <ImageStage
                key={file.id}
                ref={stage}
                src={file.viewUrl}
                label={text.describe(file)}
                orientation={orientation}
                filters={filters}
                onView={(view) => {
                  setPercent(view.percent);
                }}
                onSwipe={(direction) => {
                  step(rtl ? (direction === 1 ? -1 : 1) : direction);
                }}
              />
            ) : (
              <DocumentStage file={file} onDownload={download} />
            )}
          </div>
          {list.length > 1 && (
            <>
              <button
                type="button"
                aria-label={t('viewer.previous')}
                onClick={() => {
                  step(-1);
                }}
                className="absolute start-3 top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/20 bg-[rgba(15,14,18,.6)] text-white opacity-0 group-hover/stage:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <ViewerIcon name="previous" className="rtl:-scale-x-100" />
              </button>
              <button
                type="button"
                aria-label={t('viewer.next')}
                onClick={() => {
                  step(1);
                }}
                className="absolute end-3 top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/20 bg-[rgba(15,14,18,.6)] text-white opacity-0 group-hover/stage:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <ViewerIcon name="next" className="rtl:-scale-x-100" />
              </button>
            </>
          )}
          {help && (
            <div
              role="dialog"
              aria-label={t('viewer.shortcuts')}
              className="absolute end-3 top-3 w-[260px] rounded-[10px] border border-white/15 bg-[#24232a] p-3.5 shadow-[0_10px_28px_rgba(0,0,0,.4)]"
            >
              <h2 className="m-0 mb-2.5 text-[13px] leading-none font-semibold">
                {t('viewer.shortcuts')}
              </h2>
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px] leading-[1.3]">
                {SHORTCUTS.map(([keys, name]) => (
                  <div key={name} className="contents">
                    <dt dir="ltr" className="font-mono text-white/90">
                      {keys}
                    </dt>
                    <dd className="m-0 text-white/70">{t(`viewer.keys.${name}`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {filmstrip && list.length > 1 && (
            <div
              role="group"
              aria-label={t('viewer.filmstrip')}
              className="flex flex-none gap-1.5 overflow-x-auto border-t border-white/10 px-3 py-2"
            >
              {list.map((entry, position) => {
                const current = position === index;
                return (
                  <button
                    key={entry.id}
                    ref={current ? currentThumb : undefined}
                    type="button"
                    aria-label={text.describe(entry)}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => {
                      setCurrentId(entry.id);
                    }}
                    className={cn(
                      'size-14 flex-none cursor-pointer overflow-hidden rounded-md border-2 bg-transparent p-0',
                      current ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100',
                    )}
                  >
                    <FileThumb file={entry} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {details && (
          <DetailsPanel
            key={file.id}
            file={file}
            tenant={tenant}
            onClose={() => {
              setDetails(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A file that is not an image the viewer can draw: a PDF inline, anything else as a card. */
function DocumentStage({ file, onDownload }: { file: PatientFile; onDownload: () => void }) {
  const { t } = useTranslation('files');
  const text = useFileText();
  if (file.mimeType === 'application/pdf' && file.viewUrl !== null) {
    return (
      <iframe
        src={file.viewUrl}
        title={t('viewer.document', { name: file.originalFilename })}
        className="min-h-0 flex-1 border-0 bg-white"
      />
    );
  }
  const action =
    'inline-flex h-9 cursor-pointer items-center rounded-lg border border-white/25 bg-transparent px-3.5 text-[12.5px] leading-none font-medium text-white hover:bg-white/10';
  return (
    <div className="m-auto flex max-w-[360px] flex-col items-center gap-3 px-6 text-center">
      <span className="rounded-lg border border-white/25 px-3 py-2 font-mono text-[15px] leading-none font-semibold">
        {t(`glyph.${glyphOf(file)}`)}
      </span>
      <p dir="auto" className="m-0 text-[14px] leading-[1.4] font-medium [overflow-wrap:anywhere]">
        {file.originalFilename}
      </p>
      <p className="m-0 font-mono text-[12px] leading-none text-white/60">
        {text.size(file.sizeBytes)}
      </p>
      <p className="m-0 text-[12.5px] leading-[1.45] text-white/60">{t('viewer.noPreview')}</p>
      <div className="flex gap-2">
        {file.viewUrl !== null && (
          <a href={file.viewUrl} target="_blank" rel="noreferrer" className={action}>
            {t('viewer.open')}
          </a>
        )}
        <button type="button" onClick={onDownload} className={action}>
          {t('viewer.download')}
        </button>
      </div>
    </div>
  );
}
