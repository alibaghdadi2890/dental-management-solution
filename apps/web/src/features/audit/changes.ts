import type { AuditEntry } from '@dcm/contracts';

/**
 * What an audit entry changed, as before → after pairs a person can read (feature 7, H7): only
 * the fields that have a label, only the ones whose value differs, never raw JSON. Pure; the page
 * supplies the words.
 */

/** The fields a row may show, in the order they read best. Ids and timestamps are not here. */
export const CHANGE_FIELDS = [
  'fullName',
  'displayName',
  'name',
  'title',
  'code',
  'category',
  'phone',
  'email',
  'dateOfBirth',
  'sex',
  'address',
  'insurance',
  'medicalAlerts',
  'notes',
  'note',
  'status',
  'presence',
  'toothCode',
  'surfaces',
  'relationship',
  'isGuardian',
  'isBillingContact',
  'isEmergencyContact',
  'chargeUnit',
  'toothEffect',
  'price',
  'priceAmount',
  'baseAmount',
  'discountAmount',
  'discountMode',
  'discountValue',
  'discount',
  'subtotal',
  'total',
  'durationMinutes',
  'amount',
  'method',
  'paidAt',
  'effectiveDate',
  'reference',
  'frequent',
  'active',
  'practitionerType',
  'roles',
  'timeZone',
  'currency',
  'locale',
  'country',
  'chartMode',
  'toothNotation',
  'chartOrientation',
  'dentitionOverride',
] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];

/** Fields that are money in the entry's own currency (its `currency`, else the clinic's). */
const MONEY: ReadonlySet<string> = new Set([
  'priceAmount',
  'baseAmount',
  'discountAmount',
  'subtotal',
  'total',
  'amount',
]);

export interface Change {
  field: ChangeField;
  before: string;
  after: string;
}

export interface ChangeWords {
  /** What stands for "nothing": an absent, null or empty value. */
  empty: string;
  yes: string;
  no: string;
  money: (amount: string, currency: string) => string;
}

type Snapshot = Record<string, unknown>;

const snapshot = (value: unknown): Snapshot =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Snapshot) : {};

/** `in_progress` → "in progress": a stored word made readable, when there is no better label. */
const plain = (word: string) => word.replaceAll('_', ' ');

function show(field: string, value: unknown, currency: string, words: ChangeWords): string {
  if (value === null || value === undefined || value === '') return words.empty;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (MONEY.has(field) && /^-?\d+(\.\d{1,2})?$/.test(value)) return words.money(value, currency);
    // Free text stays as typed; a stored word (a status, a mode) loses its underscores.
    return /^[a-z]+(_[a-z]+)+$/.test(value) ? plain(value) : value;
  }
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length === 0 ? words.empty : items.map(plain).join(', ');
  }
  const object = snapshot(value);
  // `{ amount, currency }` (a catalog price) and `{ mode, value }` (a visit discount).
  if (typeof object.amount === 'string' && typeof object.currency === 'string') {
    return words.money(object.amount, object.currency);
  }
  if (typeof object.mode === 'string' && typeof object.value === 'string') {
    return object.mode === 'percent' ? `${object.value}%` : words.money(object.value, currency);
  }
  return words.empty;
}

export function changesOf(entry: AuditEntry, clinicCurrency: string, words: ChangeWords): Change[] {
  const before = snapshot(entry.before);
  const after = snapshot(entry.after);
  const currencyOf = (side: Snapshot) =>
    typeof side.currency === 'string' ? side.currency : clinicCurrency;
  const changes: Change[] = [];
  for (const field of CHANGE_FIELDS) {
    if (!(field in before) && !(field in after)) continue;
    const was = show(field, before[field], currencyOf(before), words);
    const is = show(field, after[field], currencyOf(after), words);
    if (was !== is) changes.push({ field, before: was, after: is });
  }
  return changes;
}
