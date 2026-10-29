import type { ToothCode, Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { patientFilesQuery } from '@/features/files/files-api';
import { useFiles } from '@/features/files/files-context';
import { visitFiles } from '@/features/files/gallery/gallery-filter';
import { cn } from '@/lib/utils';

/**
 * **Before photo**, then **After photo** once this visit has one of the tooth: on the rows of
 * today's planned work in Today's services. Opens the upload panel with the tooth and the visit
 * pre-filled. Nothing for work that is not on a tooth.
 */
export function PhotoButton({ visit, toothCode }: { visit: Visit; toothCode: ToothCode | null }) {
  const { t } = useTranslation('clinical');
  const { openUpload } = useFiles();
  const canRead = usePermission('file:read');
  const canWrite = usePermission('file:write');
  const files = useQuery({ ...patientFilesQuery(visit.patientId), enabled: canRead });
  if (!canWrite || toothCode === null) return null;
  const taken = visitFiles(files.data ?? [], visit.id).filter(
    (file) => file.toothCode === toothCode && file.subCategory === 'before_after',
  ).length;
  const label = t(taken === 0 ? 'flow.planned.beforePhoto' : 'flow.planned.afterPhoto');
  return (
    <button
      type="button"
      onClick={() => {
        openUpload({
          patientId: visit.patientId,
          visit,
          toothCode,
          preset: { category: 'photo', subCategory: 'before_after', note: label },
        });
      }}
      className={cn(
        'h-7 flex-none cursor-pointer rounded-md px-2.5 text-[12.5px] leading-none',
        'border border-border-control bg-surface font-medium text-ink-secondary hover:border-ink',
      )}
    >
      {label}
    </button>
  );
}
