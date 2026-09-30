import { type Visit, visitNotesSchema } from '@dcm/contracts';
import { MutationObserver, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveState } from '@/components/ui/save-state';
import { useToothLabel } from '../chart/use-chart-settings';
import { useSaveGroup } from '../use-save-group';
import { useVisitMutations } from '../visit-mutations';

const NOTES_MAX = visitNotesSchema.shape.notes.maxLength ?? undefined;

/** The save group key of the visit's clinical notes (V6). */
const NOTES_KEY = 'notes';

/**
 * The Clinical notes card (spec §Visit Workspace → Body 3): "Clinical notes" · "Belongs to this
 * visit" with the save-state indicator, over the textarea. The notes are one autosaved group
 * (`notes`, V6): debounced, "Failed to save — retry" keeps the text and re-sends it. Read-only
 * without `visit:write` (W18): the notes as text.
 */
export function NotesCard({ visit, canWrite }: { visit: Visit; canWrite: boolean }) {
  return canWrite ? <NotesEditor visit={visit} /> : <ReadOnlyNotes notes={visit.notes} />;
}

function NotesFrame({
  titleId,
  status,
  children,
}: {
  titleId: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('clinical');
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-border bg-surface px-[18px] py-4"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold">
          {t('notes.title')}
        </h2>
        <span className="text-[12.5px] leading-none text-ink-muted">{t('notes.subtitle')}</span>
        {status && <span className="ms-auto">{status}</span>}
      </div>
      {children}
    </section>
  );
}

function NotesEditor({ visit }: { visit: Visit }) {
  const { t } = useTranslation('clinical');
  const toothLabel = useToothLabel();
  const titleId = useId();
  const queryClient = useQueryClient();
  const { updateNotes } = useVisitMutations(visit.id);
  const notes = useSaveGroup({
    key: NOTES_KEY,
    serverValue: visit.notes,
    // Outlives the card, like every save group's save (the group may flush after unmount).
    save: (text) => new MutationObserver(queryClient, updateNotes).mutate({ notes: text }),
  });

  return (
    <NotesFrame titleId={titleId} status={<SaveState status={notes.state} onRetry={notes.retry} />}>
      <textarea
        aria-labelledby={titleId}
        maxLength={NOTES_MAX}
        value={notes.value}
        placeholder={t('notes.placeholder', { tooth: toothLabel('16') })}
        onChange={(event) => {
          notes.setValue(event.target.value);
        }}
        className="block min-h-[104px] w-full resize-y rounded-[8px] border border-border-strong bg-sunken px-[13px] py-[11px] text-[13px] leading-[1.65] text-ink focus:border-primary focus:bg-surface"
      />
    </NotesFrame>
  );
}

function ReadOnlyNotes({ notes }: { notes: string }) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  return (
    <NotesFrame titleId={titleId}>
      {notes.trim() === '' ? (
        <p className="m-0 text-[12.5px] leading-normal text-ink-muted">{t('notes.empty')}</p>
      ) : (
        <p className="m-0 text-[13px] leading-[1.65] whitespace-pre-wrap">{notes}</p>
      )}
    </NotesFrame>
  );
}
