import type { ToothCode } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/features/auth/use-permission';
import { cn } from '@/lib/utils';
import { useFileText } from './file-text';
import { FileTile } from './file-tile';
import { patientFilesQuery } from './files-api';
import { useFiles } from './files-context';
import { evidenceImages } from './gallery/gallery-filter';
import type { VisitOption } from './visit-options';

/**
 * The **Evidence** strip of a visit's steps (feature 10, V5): the patient's images, newest
 * first, as 96px thumbnails with their kind and date — a click opens the viewer on them — and
 * **Upload** and **Take photo**, which open the upload panel with the visit, and the selected
 * tooth, pre-filled. It opens or collapses from its header; where it starts is the step's
 * choice (`defaultOpen`). Nothing without `file:read`.
 */
export function EvidenceStrip({
  visit,
  selectedTooth,
  defaultOpen,
}: {
  visit: VisitOption & { patientId: string };
  selectedTooth: ToothCode | null;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation('files');
  const text = useFileText();
  const bodyId = useId();
  const { openUpload, openViewer } = useFiles();
  const canRead = usePermission('file:read');
  const canWrite = usePermission('file:write');
  const files = useQuery({ ...patientFilesQuery(visit.patientId), enabled: canRead });
  const [open, setOpen] = useState(defaultOpen);
  if (!canRead) return null;
  const images = evidenceImages(files.data ?? []);
  const upload = (source?: 'camera') => {
    openUpload({ patientId: visit.patientId, visit, toothCode: selectedTooth, source });
  };

  return (
    <section
      aria-label={t('evidence.title')}
      className="mb-4 rounded-xl border border-border bg-surface"
    >
      <div className="flex items-center gap-2.5 py-2.5 ps-4 pe-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => {
            setOpen((current) => !current);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[9px] border-0 bg-transparent py-1 text-start"
        >
          <span className="text-[13px] leading-none font-semibold">{t('evidence.title')}</span>
          <span className="font-mono text-[12.5px] leading-none font-medium text-ink-muted">
            {images.length}
          </span>
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={cn('text-ink-muted', open && 'rotate-180')}
          >
            <path d="m2 3.5 3 3 3-3" />
          </svg>
        </button>
        {canWrite && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                upload();
              }}
            >
              {t('evidence.upload')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                upload('camera');
              }}
            >
              {t('evidence.takePhoto')}
            </Button>
          </>
        )}
      </div>
      {open && (
        <div id={bodyId}>
          {images.length === 0 ? (
            <p className="m-0 px-4 pb-3.5 text-[12.5px] leading-[1.45] text-ink-muted">
              {t('evidence.empty')}
            </p>
          ) : (
            <ul className="m-0 flex list-none gap-2.5 overflow-x-auto px-4 pb-3.5">
              {images.map((file) => (
                <li key={file.id} className="flex w-24 flex-none flex-col gap-[5px]">
                  <FileTile
                    file={file}
                    size="lg"
                    onOpen={() => {
                      openViewer({
                        patientId: visit.patientId,
                        ids: images.map((entry) => entry.id),
                        startId: file.id,
                      });
                    }}
                  />
                  <span className="truncate text-[12px] leading-none font-medium">
                    {text.kind(file)}
                  </span>
                  <span className="font-mono text-[11.5px] leading-none text-ink-muted">
                    {text.takenDate(file)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
