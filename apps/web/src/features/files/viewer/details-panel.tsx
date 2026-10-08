import type { AuditEntry, FilePatch, PatientFile, Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/ui/button';
import { usePermission } from '@/features/auth/use-permission';
import { useStaffNames } from '@/features/users/use-staff-names';
import { apiErrorMessage } from '@/lib/api-error-message';
import { todayIn } from '@/lib/format';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { fromZonedInput, toZonedInput } from '@/lib/zoned-time';
import { useFileText } from '../file-text';
import { applyFiles, fileHistoryQuery, invalidateFiles, updateFiles } from '../files-api';
import { CategoryChips, TypeChips, VisitField } from '../meta-fields';
import { ToothField } from '../tooth-field';

type Tenant = NonNullable<Session['tenant']>;

const LABEL = 'mb-1.5 block text-[12.5px] leading-none font-medium';
const MICRO =
  'm-0 mb-2.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal';

type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'failed'; message: string };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2.5 border-b border-row-divider py-[7px]">
      <dt className="text-[12.5px] leading-[1.4] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[12.5px] leading-[1.4] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** What a `file.*` audit row is, in the History list's words. */
function eventOf(
  entry: AuditEntry,
): 'upload' | 'note' | 'orientation' | 'update' | 'archive' | 'restore' | null {
  if (entry.action === 'file.upload') return 'upload';
  if (entry.action === 'file.archive') return 'archive';
  if (entry.action === 'file.restore') return 'restore';
  if (entry.action !== 'file.update') return null;
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const changed = Object.keys(after).filter(
    (field) => JSON.stringify(after[field]) !== JSON.stringify(before[field]),
  );
  if (changed.length === 1 && changed[0] === 'note') return 'note';
  return changed.length === 1 && changed[0] === 'orientation' ? 'orientation' : 'update';
}

function History({ fileId }: { fileId: string }) {
  const { t } = useTranslation('files');
  const text = useFileText();
  const { names } = useStaffNames();
  const history = useQuery(fileHistoryQuery(fileId));
  const rows = (history.data?.items ?? []).flatMap((entry) => {
    const event = eventOf(entry);
    return event ? [{ entry, event }] : [];
  });
  if (history.isPending) {
    return (
      <p aria-busy="true" className="m-0 text-[12.5px] text-ink-muted">
        {t('details.historyLoading')}
      </p>
    );
  }
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map(({ entry, event }) => (
        <li key={entry.id} className="text-[12.5px] leading-[1.4]">
          <span className="font-medium">{t(`details.events.${event}`)}</span>
          <span className="block text-ink-muted">
            {[
              entry.actorUserId ? names.get(entry.actorUserId) : null,
              text.dateTime(entry.occurredAt),
            ]
              .filter((part) => part !== null && part !== undefined)
              .join(t('separator'))}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The viewer's Details panel (feature 8 §4): with `file:write`, the fields edit in place and
 * save as they change — category, type, tooth, visit, "taken on" (never after today), and the
 * note, saved when focus leaves it with a "Saved ✓". Under them what is only read: who uploaded
 * it and when, the original filename, size and type, the stored orientation, the archive facts,
 * the storage location (owners and platform admins) and, with `audit:read`, the file's history.
 */
export function DetailsPanel({
  file,
  tenant,
  onClose,
}: {
  file: PatientFile;
  tenant: Tenant;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('files');
  const text = useFileText();
  const queryClient = useQueryClient();
  const canWrite = usePermission('file:write');
  const canAudit = usePermission('audit:read');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [note, setNote] = useState(file.note);
  const [taken, setTaken] = useState(() => toZonedInput(file.takenAt, tenant.timeZone));
  const [takenError, setTakenError] = useState(false);
  const titleId = useId();
  const categoryId = useId();
  const typeId = useId();
  const takenId = useId();
  const noteId = useId();
  const today = todayIn(tenant.timeZone);

  const save = async (patch: FilePatch) => {
    setState({ kind: 'saving' });
    try {
      applyFiles(queryClient, await updateFiles({ ids: [file.id], patch }));
      void invalidateFiles(queryClient, file.patientId);
      setState({ kind: 'saved' });
    } catch (error) {
      setState({ kind: 'failed', message: apiErrorMessage(error, i18n) });
    }
  };

  const commitTaken = () => {
    // Untouched: the field shows minutes, and must not round a stored time down to them.
    if (taken === toZonedInput(file.takenAt, tenant.timeZone)) {
      setTakenError(false);
      return;
    }
    const iso = fromZonedInput(taken, tenant.timeZone);
    if (iso === null || taken.slice(0, 10) > today) {
      setTakenError(true);
      return;
    }
    setTakenError(false);
    void save({ takenAt: iso });
  };

  return (
    <aside
      aria-labelledby={titleId}
      className="flex w-[360px] flex-none flex-col border-s border-border bg-surface text-ink max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-10 max-md:max-h-[62%] max-md:w-auto max-md:rounded-t-xl max-md:border-s-0 max-md:border-t"
    >
      <div className="flex flex-none items-center gap-2 border-b border-inner-divider px-4 py-3">
        <h2 id={titleId} className="m-0 flex-1 text-[14px] leading-none font-semibold">
          {t('details.title')}
        </h2>
        <span role="status" className="text-[11.5px] leading-none font-medium">
          {state.kind === 'saving' && <span className="text-ink-muted">{t('details.saving')}</span>}
          {state.kind === 'saved' && (
            <span className="text-success">
              {t('details.saved')} <span aria-hidden>{'✓'}</span>
            </span>
          )}
        </span>
        <IconButton aria-label={t('details.close')} onClick={onClose}>
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        {state.kind === 'failed' && (
          <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
            {state.message || t('details.saveFailed')}
          </p>
        )}
        {canWrite ? (
          <>
            <div>
              <span id={categoryId} className={LABEL}>
                {t('fields.category')}
              </span>
              <CategoryChips
                labelledBy={categoryId}
                value={file.category}
                onChange={(category) => {
                  if (category !== file.category) void save({ category });
                }}
              />
            </div>
            {file.category !== 'other' && (
              <div>
                <span id={typeId} className={LABEL}>
                  {t('fields.type')}
                </span>
                <TypeChips
                  labelledBy={typeId}
                  category={file.category}
                  value={file.subCategory}
                  onChange={(subCategory) => void save({ subCategory })}
                />
              </div>
            )}
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3.5">
              <div>
                <span className={LABEL}>{t('fields.tooth')}</span>
                <ToothField
                  label={t('fields.tooth')}
                  value={file.toothCode}
                  onChange={(toothCode) => void save({ toothCode })}
                />
              </div>
              <div className="min-w-0">
                <span className={LABEL}>{t('fields.visit')}</span>
                <VisitField
                  patientId={file.patientId}
                  value={file.visitId}
                  known={file.visit}
                  today={today}
                  onChange={(visit) => void save({ visitId: visit?.id ?? null })}
                />
                {file.visit?.status === 'voided' && (
                  <span className="mt-1 block text-[12px] leading-none text-ink-muted">
                    {t('visitVoided')}
                  </span>
                )}
              </div>
            </div>
            <div>
              <label htmlFor={takenId} className={LABEL}>
                {t('fields.takenOn')}
              </label>
              <input
                id={takenId}
                type="datetime-local"
                value={taken}
                max={`${today}T23:59`}
                aria-invalid={takenError}
                onChange={(event) => {
                  setTaken(event.target.value);
                  setTakenError(false);
                }}
                onBlur={commitTaken}
                className="h-9 w-full rounded-lg border border-border-control bg-surface px-[11px] font-mono text-[12.5px] leading-none text-ink aria-invalid:border-danger"
              />
              {takenError && (
                <span
                  role="alert"
                  className="mt-[5px] block text-xs leading-tight font-medium text-danger"
                >
                  {t('details.futureDate')}
                </span>
              )}
            </div>
            <div>
              <label htmlFor={noteId} className={LABEL}>
                {t('fields.note')}
              </label>
              <textarea
                id={noteId}
                value={note}
                maxLength={2000}
                rows={3}
                placeholder={t('panel.notePlaceholder')}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                onBlur={() => {
                  if (note.trim() !== file.note) void save({ note: note.trim() });
                }}
                className="block w-full resize-y rounded-lg border border-border-control bg-surface px-[11px] py-2 text-[13px] leading-[1.5] text-ink"
              />
            </div>
          </>
        ) : (
          <dl className="m-0">
            <Row label={t('fields.category')}>{text.summary({ ...file, toothCode: null })}</Row>
            <Row label={t('fields.tooth')}>
              {file.toothCode ? text.tooth(file.toothCode) : t('details.none')}
            </Row>
            <Row label={t('fields.visit')}>
              {file.visit ? text.visit(file.visit) : t('details.none')}
              {file.visit?.status === 'voided' && (
                <span className="block text-ink-muted">{t('visitVoided')}</span>
              )}
            </Row>
            <Row label={t('fields.takenOn')}>{text.dateTime(file.takenAt)}</Row>
            <Row label={t('fields.note')}>
              {file.note === '' ? (
                t('details.none')
              ) : (
                <span className="whitespace-pre-wrap">{file.note}</span>
              )}
            </Row>
          </dl>
        )}

        <dl className="m-0">
          <Row label={t('details.uploadedBy')}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid size-[22px] flex-none place-items-center rounded-full border border-primary-tint-border bg-primary-tint text-[11.5px] leading-none font-semibold text-primary"
              >
                {initials(file.uploadedByName ?? '?')}
              </span>
              <span className="font-medium">{file.uploadedByName ?? t('details.someone')}</span>
            </span>
          </Row>
          <Row label={t('details.uploadedAt')}>{text.dateTime(file.uploadedAt)}</Row>
          <Row label={t('details.filename')}>
            <span dir="auto">{file.originalFilename}</span>
          </Row>
          <Row label={t('details.size')}>
            <span className="font-mono">{text.size(file.sizeBytes)}</span>
          </Row>
          <Row label={t('details.mime')}>
            <span dir="ltr" className="font-mono">
              {file.mimeType}
            </span>
          </Row>
          {file.orientation !== 0 && (
            <Row label={t('details.orientation')}>
              {t('details.degrees', { degrees: file.orientation })}
            </Row>
          )}
          {file.archivedAt !== null && (
            <>
              <Row label={t('details.archivedBy')}>
                {file.archivedByName ?? t('details.someone')}
              </Row>
              <Row label={t('details.archivedAt')}>{text.dateTime(file.archivedAt)}</Row>
              {file.archiveReason && (
                <Row label={t('details.archiveReason')}>{file.archiveReason}</Row>
              )}
            </>
          )}
        </dl>

        {file.storageKey !== null && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer leading-none font-medium text-ink-secondary">
              {t('details.technical')}
            </summary>
            <p className="m-0 mt-2 text-ink-muted">
              {t('details.storage')}
              <span
                dir="ltr"
                className={cn('mt-1 block font-mono text-[11.5px] [overflow-wrap:anywhere]')}
              >
                {file.storageKey}
              </span>
            </p>
          </details>
        )}

        {canAudit && (
          <section>
            <h3 className={MICRO}>{t('details.history')}</h3>
            <History fileId={file.id} />
          </section>
        )}
      </div>
    </aside>
  );
}
