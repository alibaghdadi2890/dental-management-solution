import type { DiagnosisEvidence, DiagnosisRecord } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { useFileText } from '@/features/files/file-text';
import { patientFilesQuery } from '@/features/files/files-api';
import { evidenceImages } from '@/features/files/gallery/gallery-filter';
import { cn } from '@/lib/utils';
import { useChartingActions } from '../workspace/charting-actions';

const NOT_SAID = '';
const CLINICAL_EXAM = 'clinical_exam';

/** The select's value for what a diagnosis cites. */
const valueOf = (seenOn: DiagnosisEvidence | null): string =>
  seenOn === null ? NOT_SAID : seenOn.kind === 'image' ? seenOn.fileId : CLINICAL_EXAM;

const evidenceOf = (value: string): DiagnosisEvidence | null =>
  value === NOT_SAID
    ? null
    : value === CLINICAL_EXAM
      ? { kind: 'clinical_exam' }
      : { kind: 'image', fileId: value };

/**
 * **Seen on** (feature 10, V5, V6; ADR-0049): what a diagnosis was seen on — one of the patient's
 * images, the newest first as in the Evidence strip, "Clinical exam", or not said. An image that
 * has since been archived stays named on the diagnosis that cites it. Read-only, it is the
 * answer as text.
 */
export function SeenOnSelect({
  record,
  canWrite,
  className,
}: {
  record: Pick<DiagnosisRecord, 'id' | 'patientId' | 'name' | 'seenOn'>;
  canWrite: boolean;
  className?: string;
}) {
  const { t } = useTranslation('clinical');
  const text = useFileText();
  const actions = useChartingActions();
  const canRead = usePermission('file:read');
  const files = useQuery({ ...patientFilesQuery(record.patientId), enabled: canRead });
  const images = evidenceImages(files.data ?? []);
  const value = valueOf(record.seenOn);
  const cited =
    record.seenOn?.kind === 'image'
      ? files.data?.find(
          (file) => record.seenOn?.kind === 'image' && file.id === record.seenOn.fileId,
        )
      : undefined;
  const label = (file: (typeof images)[number]) =>
    [text.kind(file), text.takenDate(file)].filter(Boolean).join(' · ');
  // The cited image, when the list no longer offers it (archived since).
  const extra = cited && !images.some((file) => file.id === cited.id) ? cited : undefined;

  if (!canWrite) {
    const answer =
      record.seenOn === null
        ? t('flow.seenOn.notSaid')
        : record.seenOn.kind === 'clinical_exam'
          ? t('flow.seenOn.clinicalExam')
          : cited
            ? label(cited)
            : t('flow.seenOn.image');
    return (
      <span className={cn('text-[12.5px] leading-[1.4] text-ink-secondary', className)}>
        {answer}
      </span>
    );
  }
  return (
    <select
      aria-label={t('flow.seenOn.named', { name: record.name })}
      value={value}
      onChange={(event) => {
        actions.setSeenOn(record.id, evidenceOf(event.target.value));
      }}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-border-control bg-surface px-1.5 text-[12.5px] leading-none',
        value === NOT_SAID && 'text-ink-muted',
        className,
      )}
    >
      <option value={NOT_SAID}>{t('flow.seenOn.notSaid')}</option>
      <option value={CLINICAL_EXAM}>{t('flow.seenOn.clinicalExam')}</option>
      {[...(extra ? [extra] : []), ...images].map((file) => (
        <option key={file.id} value={file.id}>
          {label(file)}
        </option>
      ))}
      {/* The cited image while the files are still loading, or hidden from this reader. */}
      {record.seenOn?.kind === 'image' && !cited && (
        <option value={record.seenOn.fileId}>{t('flow.seenOn.image')}</option>
      )}
    </select>
  );
}
