import { formatVisitNumber, type Patient, type ToothCode } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { keepOpenForToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { cn } from '@/lib/utils';
import { FileThumb, FileTile } from './file-tile';
import { patientFilesQuery } from './files-api';
import { useFiles } from './files-context';
import { FilesGallery } from './gallery/files-gallery';
import { activeFiles, recentOtherFiles, toothImages, visitFiles } from './gallery/gallery-filter';
import type { VisitOption } from './visit-options';

/** The patient's files for a surface that only shows them to those who may read them. */
function usePatientFiles(patientId: string) {
  const canRead = usePermission('file:read');
  const files = useQuery({ ...patientFilesQuery(patientId), enabled: canRead });
  return files.data;
}

const ADD_SIZE = {
  xs: 'size-12 rounded-md',
  sm: 'size-16 rounded-lg',
  md: 'size-[72px] rounded-lg',
};

/** The **+** tile that leads, or ends, a row of thumbnails: it opens the upload panel. */
function AddTile({
  label,
  size,
  onClick,
}: {
  label: string;
  size: keyof typeof ADD_SIZE;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid flex-none cursor-pointer place-items-center border border-dashed border-border-strong bg-faint text-ink-muted hover:border-primary hover:text-primary',
        ADD_SIZE[size],
      )}
    >
      <svg
        aria-hidden
        width="14"
        height="14"
        viewBox="0 0 16 16"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M8 3v10M3 8h10" />
      </svg>
    </button>
  );
}

/**
 * The Overview's **Recent files** card (feature 8 §2): the six most recently taken, a link to
 * the Files tab and an Upload button. Left out while the patient has no files — the empty Files
 * tab does the inviting.
 */
export function RecentFilesCard({
  patient,
  onViewAll,
}: {
  patient: Patient;
  onViewAll: () => void;
}) {
  const { t } = useTranslation('files');
  const { openUpload, openViewer } = useFiles();
  const canWrite = usePermission('file:write') && patient.mergedIntoId === null;
  const files = activeFiles(usePatientFiles(patient.id) ?? []);
  if (files.length === 0) return null;
  const recent = files.slice(0, 6);
  return (
    <Card
      title={t('recent.title')}
      action={
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={onViewAll}
            className="flex cursor-pointer items-center gap-1 text-[12.5px] leading-none font-medium text-primary hover:underline"
          >
            {t('recent.viewAll')}
            <span aria-hidden className="rtl:-scale-x-100">
              {'→'}
            </span>
          </button>
          {canWrite && (
            <IconButton
              aria-label={t('recent.upload')}
              title={t('recent.upload')}
              onClick={() => {
                openUpload({ patientId: patient.id });
              }}
            >
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M8 10.5v-8m0 0-3 3m3-3 3 3M3 13.5h10" />
              </svg>
            </IconButton>
          )}
        </span>
      }
    >
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {recent.map((file) => (
          <li key={file.id}>
            <FileTile
              file={file}
              size="sm"
              onOpen={() => {
                openViewer({
                  patientId: patient.id,
                  ids: recent.map((entry) => entry.id),
                  startId: file.id,
                });
              }}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "· 2 images" beside a tooth's label in the tooth panel's header; nothing for none. */
export function ToothImageCount({ patientId, code }: { patientId: string; code: ToothCode }) {
  const { t } = useTranslation('files');
  const count = toothImages(usePatientFiles(patientId) ?? [], code).length;
  if (count === 0) return null;
  return (
    <span className="text-[11.5px] leading-none font-medium text-ink-muted">
      {t('images', { count })}
    </span>
  );
}

/**
 * The tooth panel's **Images** row (feature 8 §2, §3): the tooth's images as 48px thumbnails and
 * a **+** tile that opens the upload panel with the tooth — and, inside a visit, the visit —
 * pre-filled. A thumbnail opens the viewer on this tooth's images. Without `file:write` and
 * without images there is nothing to show.
 */
export function ToothImages({
  patientId,
  code,
  visit,
}: {
  patientId: string;
  code: ToothCode;
  visit: VisitOption | null;
}) {
  const { t } = useTranslation('files');
  const toothLabel = useToothLabel();
  const { openUpload, openViewer } = useFiles();
  const canWrite = usePermission('file:write');
  const images = toothImages(usePatientFiles(patientId) ?? [], code);
  if (images.length === 0 && !canWrite) return null;
  return (
    <section aria-label={t('toothImages.title')} className="mt-[18px]">
      <h3 className="m-0 mb-[9px] text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal">
        {t('toothImages.title')}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {images.map((file) => (
          <FileTile
            key={file.id}
            file={file}
            size="xs"
            onOpen={() => {
              openViewer({ patientId, ids: images.map((entry) => entry.id), startId: file.id });
            }}
          />
        ))}
        {canWrite && (
          <AddTile
            size="xs"
            label={t('toothImages.add', { tooth: toothLabel(code) })}
            onClick={() => {
              openUpload({ patientId, toothCode: code, visit });
            }}
          />
        )}
      </div>
    </section>
  );
}

function Strip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-none items-center gap-2">
      <span className="text-[11.5px] leading-none font-medium text-ink-muted [writing-mode:vertical-rl] rtl:rotate-180">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * The visit workspace's **Files** strip (feature 8 §3): always there, so the dentist never
 * leaves the visit to see or add a file. A **+** tile, then two groups — **This visit**, newest
 * first, and **Recent**, the patient's other files of the last 90 days — and an **All files**
 * tile that opens the whole gallery in a dialog over the visit, uploads from it linked to the
 * visit. A file added while the strip is on screen arrives first in its row with a highlight.
 */
export function VisitFilesStrip({
  patient,
  visit,
  selectedTooth,
}: {
  patient: Patient | undefined;
  visit: VisitOption & { patientId: string };
  /** The tooth selected in the chart: a **+** from here pre-fills it (F5). */
  selectedTooth: ToothCode | null;
}) {
  const { t } = useTranslation('files');
  const { data: session } = useSession();
  const { openUpload, openViewer } = useFiles();
  const canRead = usePermission('file:read');
  const canWrite = usePermission('file:write');
  const all = usePatientFiles(visit.patientId);
  const [allOpen, setAllOpen] = useState(false);
  // The files there when the strip first had its list: anything after them is new.
  const [known, setKnown] = useState<ReadonlySet<string> | null>(null);
  if (known === null && all !== undefined) setKnown(new Set(all.map((file) => file.id)));

  if (!canRead) return null;
  const mine = visitFiles(all ?? [], visit.id);
  const recent = recentOtherFiles(all ?? [], visit.id, new Date());
  const view = (ids: readonly string[], startId: string) => {
    openViewer({ patientId: visit.patientId, ids, startId });
  };

  return (
    <section
      aria-label={t('strip.title')}
      className="mb-4 rounded-xl border border-border bg-surface px-[18px] py-4"
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <h2 className="m-0 text-[14px] leading-none font-semibold">{t('strip.title')}</h2>
        <span className="rounded-sm bg-subtle px-1.5 py-[3px] font-mono text-[11.5px] leading-none font-medium text-ink-tertiary">
          {mine.length}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {/* The thumbnails scroll; "All files" stays in view beside them. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto pb-1">
          {canWrite && (
            <AddTile
              size="md"
              label={t('strip.add')}
              onClick={() => {
                openUpload({ patientId: visit.patientId, visit, toothCode: selectedTooth });
              }}
            />
          )}
          {mine.length > 0 ? (
            <Strip label={t('strip.thisVisit')}>
              {mine.map((file) => (
                <FileTile
                  key={file.id}
                  file={file}
                  size="md"
                  highlighted={known !== null && !known.has(file.id)}
                  onOpen={() => {
                    view(
                      mine.map((entry) => entry.id),
                      file.id,
                    );
                  }}
                />
              ))}
            </Strip>
          ) : (
            <p className="m-0 max-w-[220px] flex-none text-[12.5px] leading-[1.45] text-ink-muted">
              {t('strip.empty')}
            </p>
          )}
          {recent.length > 0 && (
            <>
              <span aria-hidden className="h-[72px] w-px flex-none bg-inner-divider" />
              <Strip label={t('strip.recent')}>
                {recent.map((file) => (
                  <FileTile
                    key={file.id}
                    file={file}
                    size="md"
                    onOpen={() => {
                      view(
                        recent.map((entry) => entry.id),
                        file.id,
                      );
                    }}
                  />
                ))}
              </Strip>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setAllOpen(true);
          }}
          className="grid size-[72px] flex-none cursor-pointer place-items-center rounded-lg border border-border-control bg-surface px-1.5 text-center text-[12px] leading-[1.25] font-medium text-primary hover:border-primary"
        >
          {t('strip.allFiles')}
        </button>
      </div>
      {patient && session?.tenant && (
        <Dialog.Root open={allOpen} onOpenChange={setAllOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-30 animate-fadein bg-[rgba(27,26,31,.34)]" />
            <Dialog.Content
              aria-describedby={undefined}
              onPointerDownOutside={keepOpenForToast}
              onInteractOutside={keepOpenForToast}
              className="fixed inset-6 z-30 flex animate-popin flex-col overflow-hidden rounded-xl bg-background shadow-[0_18px_48px_rgba(27,26,31,.2)]"
            >
              <div className="flex flex-none items-center gap-3 border-b border-border bg-surface px-5 py-3">
                <Dialog.Title className="m-0 flex-1 text-[15px] leading-tight font-semibold">
                  {t('allFiles.title', { patient: patient.fullName })}
                  <span className="ms-2 font-mono text-[12px] font-normal text-ink-muted">
                    {formatVisitNumber(visit.displayNumber)}
                  </span>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton aria-label={t('viewer.close')}>
                    <svg
                      aria-hidden
                      width="11"
                      height="11"
                      viewBox="0 0 10 10"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path d="m2 2 6 6M8 2 2 8" />
                    </svg>
                  </IconButton>
                </Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                <FilesGallery patient={patient} tenant={session.tenant} visit={visit} />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}

/**
 * In the post-visit summary (feature 8 §3): "Files added in this visit: n" with their
 * thumbnails and a **+** tile — X-rays are often added right after the clinical work.
 */
export function VisitFilesLine({ visit }: { visit: VisitOption & { patientId: string } }) {
  const { t } = useTranslation('files');
  const { openUpload, openViewer } = useFiles();
  const canRead = usePermission('file:read');
  const canWrite = usePermission('file:write');
  const files = visitFiles(usePatientFiles(visit.patientId) ?? [], visit.id);
  if (!canRead || (files.length === 0 && !canWrite)) return null;
  return (
    <div className="mt-4 border-t border-inner-divider pt-3.5">
      <p className="m-0 mb-2 text-[12.5px] leading-none font-medium text-ink-secondary">
        {t('postVisit.added', { count: files.length })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {files.map((file) => (
          <FileTile
            key={file.id}
            file={file}
            size="xs"
            onOpen={() => {
              openViewer({
                patientId: visit.patientId,
                ids: files.map((entry) => entry.id),
                startId: file.id,
              });
            }}
          />
        ))}
        {canWrite && (
          <AddTile
            size="xs"
            label={t('postVisit.add')}
            onClick={() => {
              openUpload({ patientId: visit.patientId, visit });
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The patients list's quick view (feature 8 §5): "Files n" with the first three thumbnails, a
 * link to the record's Files tab. Nothing for a patient without files.
 */
export function QuickViewFiles({ patient }: { patient: Patient }) {
  const { t } = useTranslation('files');
  const files = activeFiles(usePatientFiles(patient.id) ?? []);
  if (files.length === 0) return null;
  return (
    <Link
      to="/patients/$patientId"
      params={{ patientId: patient.id }}
      search={{ tab: 'files' }}
      aria-label={t('quickView.open', { patient: patient.fullName })}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-faint px-3 py-2 hover:border-primary"
    >
      <span className="text-[12.5px] leading-none font-medium">{t('quickView.label')}</span>
      <span className="rounded-sm bg-subtle px-1.5 py-[3px] font-mono text-[11.5px] leading-none font-medium text-ink-tertiary">
        {files.length}
      </span>
      <span className="ms-auto flex gap-1">
        {files.slice(0, 3).map((file) => (
          <span
            key={file.id}
            className="block size-8 overflow-hidden rounded-[5px] border border-border"
          >
            <FileThumb file={file} />
          </span>
        ))}
      </span>
    </Link>
  );
}
