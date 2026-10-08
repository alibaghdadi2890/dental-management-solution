import {
  type AuditEntry,
  formatReceiptNumber,
  formatVisitNumber,
  type PatientName,
  type VisitNumber,
} from '@dcm/contracts';

/**
 * An audit entry as a sentence a person understands (feature 7, H7): "Voided visit V-000045",
 * never a table name or an id. Pure: this decides which sentence and what goes in it; the page
 * translates the key and renders the subject as a link.
 */

/** The record a sentence names, and where its link goes. */
export type Subject =
  | { kind: 'patient'; id: string; label: string }
  | { kind: 'visit'; id: string; label: string }
  | { kind: 'receipt'; paymentId: string; label: string }
  | { kind: 'catalog'; label: string }
  /** A patient's file: its link opens the viewer on the record's Files tab (feature 8). */
  | { kind: 'file'; patientId: string; fileId: string; label: string }
  | { kind: 'text'; label: string };

export interface Sentence {
  /** Under `activity:actions.`; `fallback` when the action has no sentence of its own. */
  key: string;
  /** Interpolated as text: a name, an amount, a method. */
  values: Record<string, string>;
  /** Shown in place of `{{subject}}`; null when the sentence names nothing. */
  subject: Subject | null;
  /** The patient a visit or a payment is about, when the subject is not the patient. */
  about: Subject | null;
}

/** What the page has looked up for the entries on screen. */
export interface Lookups {
  patients: ReadonlyMap<string, PatientName>;
  visits: ReadonlyMap<string, VisitNumber>;
  staff: ReadonlyMap<string, string>;
  money: (amount: string, currency: string) => string;
  /** A tooth code in the clinic's notation. */
  tooth: (code: string) => string;
  /** The label of a payment method, an adjustment reason, or a file's category or type; the
   * raw text when it has none. */
  label: (group: 'method' | 'reason' | 'fileCategory' | 'fileType', value: string) => string;
}

type Snapshot = Record<string, unknown>;

const snapshot = (value: unknown): Snapshot =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Snapshot) : {};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A field from the after snapshot, else the before one (a delete keeps its record there). */
function field(entry: AuditEntry, key: string): string | null {
  return text(snapshot(entry.after)[key]) ?? text(snapshot(entry.before)[key]);
}

/** "Extraction (EXT) · tooth 46": a service, plan or diagnosis as it was recorded. */
function recordName(entry: AuditEntry, lookups: Lookups): string {
  const name = field(entry, 'name');
  const code = field(entry, 'code');
  const tooth = field(entry, 'toothCode');
  const base = name && code ? `${name} (${code})` : (name ?? code ?? '');
  return tooth && base ? `${base} · ${lookups.tooth(tooth)}` : base;
}

function patientSubject(
  id: string | null,
  lookups: Lookups,
  fallback?: string | null,
): Subject | null {
  if (id === null) return fallback ? { kind: 'text', label: fallback } : null;
  const known = lookups.patients.get(id);
  const label = known?.fullName ?? fallback;
  return label ? { kind: 'patient', id, label } : null;
}

function visitSubject(id: string | null, lookups: Lookups): Subject | null {
  if (id === null) return null;
  const known = lookups.visits.get(id);
  return known ? { kind: 'visit', id, label: formatVisitNumber(known.displayNumber) } : null;
}

/** `treatment_plan.reprice` → "Treatment plan · reprice": an action nobody wrote a sentence for. */
export function readableAction(action: string): string {
  const [resource = action, ...verb] = action.split('.');
  const words = (part: string) => part.replaceAll('_', ' ');
  const head = words(resource);
  const sentence = head.charAt(0).toUpperCase() + head.slice(1);
  return verb.length > 0 ? `${sentence} · ${words(verb.join(' '))}` : sentence;
}

/** The actions with a sentence under `activity:actions.<action>` and no special case below. */
const PLAIN = new Set([
  'patient.create',
  'patient.update',
  'patient.dentition',
  'patient.archive',
  'patient.restore',
  'patient.merge',
  'contact.merge',
  'visit.start',
  'visit.pause',
  'visit.resume',
  'visit.discard',
  'visit.complete',
  'visit.amend',
  'visit.discount',
  'visit.checkout',
  'visit.void',
  'visit.unfinished_answered',
  'visit_service.update',
  'diagnosis_record.resolve',
  'diagnosis_record.reopen',
  'treatment_plan.update',
  'treatment_plan.start',
  'treatment_plan.cancel',
  'treatment_plan.perform',
  'treatment_plan.unperform',
  'treatment_plan.session',
  'treatment_plan.session_delete',
  'treatment_plan.reprice',
  'tooth_status.set',
  'tooth_presence.set',
  'tooth_presence.remove',
  'clinical.repoint',
  'ledger_entry.repoint',
  'file.repoint',
  'user.create',
  'user.update',
  'user.deactivate',
  'user.reactivate',
  'user.reset_password',
  'user.password_change',
  'user.roles_assign',
  'role.create',
  'tenant.provision',
  'tenant.update',
  'tenant.suspend',
  'tenant.reactivate',
  'branch.create',
  'branch.update',
  'room.create',
  'room.update',
]);

/** Actions whose sentence carries the record's own name as `{{name}}`. */
const NAMED = new Set([
  'visit_service.create',
  'visit_service.delete',
  'visit_service.unfinished',
  'diagnosis_record.create',
  'diagnosis_record.delete',
  'treatment_plan.create',
  'treatment_plan.delete',
]);

export function sentenceOf(entry: AuditEntry, lookups: Lookups): Sentence {
  const { action } = entry;
  const after = snapshot(entry.after);
  const before = snapshot(entry.before);
  const patient = patientSubject(entry.patientId, lookups, field(entry, 'fullName'));
  const visit = visitSubject(entry.visitId, lookups);
  const prefix = action.split('.')[0] ?? '';
  const done = (
    key: string,
    subject: Subject | null,
    values: Record<string, string> = {},
    about: Subject | null = null,
  ): Sentence => ({ key, values, subject, about: about?.label === subject?.label ? null : about });

  // --- Payments ---
  if (prefix === 'payment') {
    const number = after.receiptNumber;
    const receipt: Subject | null =
      typeof number === 'number'
        ? { kind: 'receipt', paymentId: entry.resourceId, label: formatReceiptNumber(number) }
        : null;
    const amount = text(after.amount);
    const currency = text(after.currency);
    const method = text(after.method);
    const values = {
      amount: amount && currency ? lookups.money(amount, currency) : '',
      method: method ? lookups.label('method', method) : '',
    };
    if (action === 'payment.create') return done('payment.create', receipt, values, patient);
    if (action === 'payment.refund') return done('payment.refund', receipt, values, patient);
    if (action === 'payment.void') return done('payment.void', receipt, values, patient);
  }
  if (action === 'ledger_entry.create') {
    const amount = text(after.amount) ?? '0';
    const currency = text(after.currency) ?? '';
    const less = amount.startsWith('-');
    const values = { amount: lookups.money(amount.replace('-', ''), currency) };
    if (after.kind === 'opening_balance') return done('ledger_entry.opening', patient, values);
    return done(less ? 'ledger_entry.less' : 'ledger_entry.more', patient, values);
  }

  // --- Files (feature 8, F15) ---
  if (prefix === 'file' && action !== 'file.repoint') {
    const category = field(entry, 'category');
    const type = field(entry, 'subCategory');
    const tooth = field(entry, 'toothCode');
    // "X-ray · Panoramic · #36": what the file is, in the clinic's words.
    const what = [
      category ? lookups.label('fileCategory', category) : null,
      type ? lookups.label('fileType', type) : null,
      tooth ? lookups.tooth(tooth) : null,
    ]
      .filter((part) => part !== null)
      .join(' · ');
    const filename = field(entry, 'originalFilename');
    const file: Subject | null =
      entry.patientId !== null && entry.resourceType === 'file' && filename
        ? { kind: 'file', patientId: entry.patientId, fileId: entry.resourceId, label: filename }
        : null;
    const changed = Object.keys(after).filter(
      (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
    );
    const key =
      action !== 'file.update'
        ? action
        : changed.length === 1 && changed[0] === 'note'
          ? 'file.note'
          : changed.length === 1 && changed[0] === 'orientation'
            ? 'file.orientation'
            : 'file.update';
    const known = ['file.upload', 'file.update', 'file.archive', 'file.restore'];
    return done(
      known.includes(action) ? key : 'fallback',
      patient,
      { what, action: readableAction(action) },
      file,
    );
  }

  // --- Catalog ---
  if (prefix === 'catalog') {
    const subject: Subject = { kind: 'catalog', label: field(entry, 'code') ?? '' };
    const priceOf = (side: Snapshot) => JSON.stringify(side.price ?? side.priceAmount ?? null);
    const priceOnly =
      action === 'catalog.service.update' &&
      priceOf(before) !== priceOf(after) &&
      Object.keys(after).every(
        (key) => key === 'price' || JSON.stringify(after[key]) === JSON.stringify(before[key]),
      );
    return done(priceOnly ? 'catalog.service.price' : action, subject);
  }

  // --- Contacts ---
  if (action === 'contact.link' || action === 'contact.roles' || action === 'contact.unlink') {
    return done(action, patient, { name: field(entry, 'fullName') ?? '' });
  }
  if (action === 'contact.update') {
    const name = field(entry, 'fullName');
    return done(action, name ? { kind: 'text', label: name } : null);
  }

  // --- Users and settings: the name is in the snapshot, or the staff list ---
  if (prefix === 'user') {
    const name = field(entry, 'displayName') ?? lookups.staff.get(entry.resourceId) ?? null;
    return done(
      PLAIN.has(action) ? action : 'fallback',
      name ? { kind: 'text', label: name } : null,
    );
  }
  if (prefix === 'role' || prefix === 'branch' || prefix === 'room') {
    const name = field(entry, 'name');
    return done(
      PLAIN.has(action) ? action : 'fallback',
      name ? { kind: 'text', label: name } : null,
    );
  }
  if (prefix === 'tenant') return done(PLAIN.has(action) ? action : 'fallback', null);

  // --- Visits and the clinical record ---
  if (action === 'visit.update') {
    return done('notes' in after ? 'visit.notes' : 'visit.discount_live', visit, {}, patient);
  }
  if (prefix === 'visit' || prefix === 'visit_service') {
    const values: Record<string, string> = NAMED.has(action)
      ? { name: recordName(entry, lookups) }
      : {};
    return done(
      PLAIN.has(action) || NAMED.has(action) ? action : 'fallback',
      visit,
      values,
      patient,
    );
  }
  if (prefix === 'plan_group') {
    return done(action, patient, { name: field(entry, 'title') ?? '' });
  }
  if (NAMED.has(action)) return done(action, patient, { name: recordName(entry, lookups) }, visit);
  if (PLAIN.has(action)) {
    return done(action, patient, {}, prefix === 'patient' || prefix === 'contact' ? null : visit);
  }
  return done('fallback', patient ?? visit, { action: readableAction(action) });
}
