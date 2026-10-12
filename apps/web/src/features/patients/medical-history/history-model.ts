import type {
  MedicalHistory,
  MedicalHistoryInput,
  MedicalItem,
  MedicalOption,
  MedicalOptionKind,
} from '@dcm/contracts';

/**
 * The medical-history fields' model (feature 10, V3, V13): pure changes to a
 * `MedicalHistoryInput`, the pills of each list and what its box suggests. Shared by the create
 * panel, the Patient information tab and the visit's Intake step.
 */

const LISTS = {
  allergy: { ids: 'allergyIds', none: 'noKnownAllergies', items: 'allergies' },
  condition: { ids: 'conditionIds', none: 'noConditions', items: 'conditions' },
} as const;

/** Adds the item, last. Having an item is never "none". */
export function addItem(
  history: MedicalHistoryInput,
  kind: MedicalOptionKind,
  id: string,
): MedicalHistoryInput {
  const { ids, none } = LISTS[kind];
  if (history[ids].includes(id)) return history;
  return { ...history, [ids]: [...history[ids], id], [none]: false };
}

export function removeItem(
  history: MedicalHistoryInput,
  kind: MedicalOptionKind,
  id: string,
): MedicalHistoryInput {
  const { ids } = LISTS[kind];
  return { ...history, [ids]: history[ids].filter((item) => item !== id) };
}

/** "None known" / "None": the explicit answer, which clears the list. Again takes it back. */
export function toggleNone(
  history: MedicalHistoryInput,
  kind: MedicalOptionKind,
): MedicalHistoryInput {
  const { ids, none } = LISTS[kind];
  return { ...history, [ids]: [], [none]: !history[none] };
}

export function isNone(history: MedicalHistoryInput, kind: MedicalOptionKind): boolean {
  return history[LISTS[kind].none];
}

/**
 * The pills of one list, in the order they were added. A name comes from the clinic's list, or
 * from the patient's saved history (`stored`) for an item that list no longer holds; an id
 * neither knows (the lists are still loading) is left out until one does.
 */
export function pillsOf(
  history: MedicalHistoryInput,
  kind: MedicalOptionKind,
  options: readonly MedicalOption[],
  stored: MedicalHistory | undefined,
): MedicalItem[] {
  const names = new Map<string, string>();
  for (const item of stored?.[LISTS[kind].items] ?? []) names.set(item.id, item.name);
  for (const option of options) if (option.kind === kind) names.set(option.id, option.name);
  return history[LISTS[kind].ids].flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [{ id, name }];
  });
}

const fold = (text: string) => text.trim().toLowerCase();

/** What a list's box offers for the text typed in it. */
export interface Suggestions {
  /** The clinic's active options the patient does not have, matching the text. */
  options: MedicalItem[];
  /** The text itself, when it names nothing the clinic offers yet: "Add …". */
  create: string | null;
}

/**
 * The suggestions of one list: the clinic's active options that the patient does not have and
 * whose name contains `text`, those starting with it first, then by name. `create` is the text
 * when no active option is called exactly that — a new name, or one that was marked inactive.
 */
export function suggestionsOf(
  history: MedicalHistoryInput,
  kind: MedicalOptionKind,
  options: readonly MedicalOption[],
  text: string,
): Suggestions {
  const typed = fold(text);
  const taken = new Set(history[LISTS[kind].ids]);
  const offered = options.filter((option) => option.kind === kind && option.active);
  const rank = (name: string) => (fold(name).startsWith(typed) ? 0 : 1);
  return {
    options: offered
      .filter((option) => !taken.has(option.id) && fold(option.name).includes(typed))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
      .map(({ id, name }) => ({ id, name })),
    create:
      typed === '' || offered.some((option) => fold(option.name) === typed) ? null : text.trim(),
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Whether two histories store the same thing; the order of the items never matters. */
export function sameHistory(a: MedicalHistoryInput, b: MedicalHistoryInput): boolean {
  return (
    a.noKnownAllergies === b.noKnownAllergies &&
    a.noConditions === b.noConditions &&
    (a.medication ?? '').trim() === (b.medication ?? '').trim() &&
    sameIds(a.allergyIds, b.allergyIds) &&
    sameIds(a.conditionIds, b.conditionIds)
  );
}
