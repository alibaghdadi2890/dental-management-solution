import type { ToothCode } from '@dcm/contracts';
import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { useFiles } from './files-context';
import type { VisitOption } from './visit-options';

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/**
 * Two of the three ways in (feature 8, F6), for the screen that mounts it — the patient record,
 * the visit workspace: **drop** a file anywhere and a full-surface overlay says where it will
 * go; **paste** an image and it goes the same way. Both open the upload panel with what the
 * screen knows (F5): the visit, the selected tooth. Renders nothing, and listens to nothing,
 * without `file:write`, and stands aside while the panel or the viewer is open — the panel takes
 * further drops itself.
 */
export function FileDropSurface({
  patientId,
  patientName,
  visit,
  toothCode,
}: {
  patientId: string;
  patientName: string | undefined;
  visit?: VisitOption | null | undefined;
  toothCode?: ToothCode | null | undefined;
}) {
  const { t } = useTranslation('files');
  const canWrite = usePermission('file:write');
  const { openUpload, busy } = useFiles();
  const enabled = canWrite && !busy;
  // `dragenter` and `dragleave` fire for every element crossed: only the depth tells in from out.
  const [depth, setDepth] = useState(0);

  const open = useEffectEvent((files: File[]) => {
    if (files.length > 0) openUpload({ patientId, visit, toothCode, files });
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const enter = (event: DragEvent) => {
      if (hasFiles(event)) setDepth((current) => current + 1);
    };
    const leave = (event: DragEvent) => {
      if (hasFiles(event)) setDepth((current) => Math.max(0, current - 1));
    };
    const over = (event: DragEvent) => {
      // Without this the browser would open the file instead of handing it over.
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDepth(0);
      open([...(event.dataTransfer?.files ?? [])]);
    };
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      open(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [enabled]);

  if (!enabled || depth === 0) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-0 z-40 grid animate-fadein place-items-center bg-[rgba(59,63,143,.14)] p-6"
    >
      <div className="rounded-xl border-2 border-dashed border-primary bg-surface px-9 py-7 text-center shadow-[0_18px_48px_rgba(27,26,31,.2)]">
        <p className="m-0 text-[16px] leading-[1.3] font-semibold text-primary">
          {t('drop.overlay', { patient: patientName ?? '' })}
        </p>
        <p className="m-0 mt-1.5 text-[12.5px] leading-none text-ink-muted">{t('drop.hint')}</p>
      </div>
    </div>
  );
}
