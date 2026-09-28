import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';

/**
 * What a draft is: someone being added (a staged pick, a new contact being typed) — which staging
 * another contact would replace — or a role editor's changes to a link.
 */
export type ContactDraftKind = 'adding' | 'roles';

type Report = (id: string, kind: ContactDraftKind | null) => void;

/**
 * Work in progress on a patient's contacts that is not form state — a staged pick, a role editor
 * with changes, a new contact being typed — reported up so the patient form counts it as unsaved
 * (its "Unsaved" badge and leave guard), without it becoming a change Save would send.
 */
export const ContactDraftContext = createContext<Report | null>(null);

/** Reports whether this component holds an unsaved contact draft of `kind` (no-op outside a
 * provider). */
export function useContactDraft(dirty: boolean, kind: ContactDraftKind): void {
  const report = useContext(ContactDraftContext);
  const id = useId();
  useEffect(() => {
    report?.(id, dirty ? kind : null);
  }, [report, id, dirty, kind]);
  useEffect(
    () => () => {
      report?.(id, null);
    },
    [report, id],
  );
}

/**
 * The provider's side: `report` for `ContactDraftContext`, whether any draft is unsaved, and
 * whether someone is being added.
 */
export function useContactDrafts(): { dirty: boolean; adding: boolean; report: Report } {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ContactDraftKind>>(() => new Map());
  const report = useCallback<Report>((id, kind) => {
    setDrafts((current) => {
      if ((current.get(id) ?? null) === kind) return current;
      const next = new Map(current);
      if (kind) next.set(id, kind);
      else next.delete(id);
      return next;
    });
  }, []);
  return {
    dirty: drafts.size > 0,
    adding: [...drafts.values()].includes('adding'),
    report,
  };
}
