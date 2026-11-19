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
  /** "November 2026" for `2026-11`, in the UI language. */
  month: (month: string) => string;
  /** A tooth code in the clinic's notation. */
  tooth: (code: string) => string;
  /** The label of a payment method, an adjustment reason, a file's category or type, a visit's
   * type, a plan's priority or an expense category's key; the raw text when it has none. */
  label: (
    group:
      | 'method'
      | 'reason'
      | 'fileCategory'
      | 'fileType'
      | 'visitType'
      | 'priority'
      | 'expenseCategory',
    value: string,
  ) => string;
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

/** The schedule's actions with a sentence under `activity:actions.<action>`. */
const SCHEDULE: ReadonlySet<string> = new Set([
  'appointment.book',
  'appointment.reschedule',
  'appointment.resize',
  'appointment.confirm',
  'appointment.check_in',
  'appointment.undo_check_in',
  'appointment.room',
  'appointment.cancel',
  'appointment.no_show',
  'appointment.start',
  'appointment.undo_start',
  'appointment.complete',
  'follow_up.recommend',
  'follow_up.book',
  'follow_up.reopen',
  'follow_up.will_call',
  'follow_up.decline',
]);

/** Expenses and payroll (feature 17): the actions with a sentence of their own. */
const EXPENSES: ReadonlySet<string> = new Set([
  'expense.record',
  'expense.update',
  'expense.void',
  'expense_category.create',
  'expense_category.rename',
  'expense_category.deactivate',
  'expense_category.reactivate',
  'expense_category.delete',
  'fixed_expense.create',
  'fixed_expense.update',
  'fixed_expense.pause',
  'fixed_expense.resume',
  'fixed_expense.end',
  'fixed_expense_item.confirm',
  'fixed_expense_item.skip',
  'fixed_expense_item.unskip',
]);
const PAYROLL: ReadonlySet<string> = new Set([
  'employee.create',
  'employee.update',
  'employee.link',
  'employee.unlink',
  'employee.leave',
  'employee.rejoin',
  'employee.remove',
  'employee_salary.change',
  'payroll_line.adjust',
  'payroll_line.confirm',
  'payroll_line.skip',
  'payroll_line.unskip',
  'payroll_line.void',
]);

const LABS: ReadonlySet<string> = new Set([
  'lab.create',
  'lab.update',
  'lab.opening_balance',
  'lab_service.create',
  'lab_service.update',
  'lab_payment.record',
  'lab_payment.void',
  'lab_adjustment.record',
  ...[
    'create',
    'update',
    'send',
    'receive',
    'expected',
    'done',
    'send_back',
    'remake',
    'hold',
    'resume',
    'cancel',
    'undo',
    'link',
    'unlink',
    'relink',
    'cost',
    'trip_dates',
    'attachments',
  ].map((verb) => `lab_order.${verb}`),
]);

/** Inventory (feature 20a): the actions with a sentence of their own. */
const INVENTORY: ReadonlySet<string> = new Set([
  'inventory_item.create',
  'inventory_item.update',
  'inventory_item.ordered',
  'inventory_item.unordered',
  'inventory_item.report_count',
  'inventory_item.branch_level',
  'inventory_item.opening_cost',
  'inventory_category.create',
  'inventory_category.rename',
  'inventory_category.deactivate',
  'inventory_category.reactivate',
  'inventory_category.delete',
  'inventory_supplier.create',
  'inventory_supplier.update',
  'inventory_supplier.opening_balance',
  'inventory_receipt.receive',
  'inventory_receipt.price',
  'inventory_receipt.edit',
  'inventory_receipt.void',
  'inventory_receipt.attach',
  'inventory_receipt.detach',
  'inventory_movement.take_out',
  'inventory_movement.undo',
  'inventory_movement.reverse',
  'inventory_movement.adjust',
  'inventory_movement.opening',
  'inventory_count.start',
  'inventory_count.apply',
  'inventory_count.discard',
  'inventory_payment.record',
  'inventory_payment.void',
  'inventory_adjustment.record',
  'inventory_settings.update',
]);

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
  'visit.times',
  'visit.history_confirm',
  'visit.history_unconfirm',
  'visit_service.update',
  'diagnosis_record.resolve',
  'diagnosis_record.reopen',
  'diagnosis_record.seen_on',
  'treatment_plan.accept',
  'treatment_plan.unaccept',
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

  // --- The medical-history lists (feature 10): the Catalog's own tab ---
  if (prefix === 'medical_option') {
    const known = ['create', 'update', 'delete', 'deactivate'].map(
      (verb) => `medical_option.${verb}`,
    );
    const name = field(entry, 'name');
    return done(
      known.includes(action) ? action : 'fallback',
      name ? { kind: 'catalog', label: name } : null,
      { action: readableAction(action) },
    );
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

  // --- Compensation (feature 13b): the dentist is named in the snapshot ---
  if (prefix === 'compensation') {
    const dentist = field(entry, 'dentist');
    const amount = text(after.amount);
    const currency = text(after.currency);
    const known = [
      'agreement_create',
      'agreement_end',
      'agreement_supersede',
      'adjustment_record',
      'adjustment_void',
      'payout_record',
      'payout_void',
      'period_close',
      'period_reopen',
    ].map((verb) => `compensation.${verb}`);
    return done(
      known.includes(action) ? action : 'fallback',
      dentist ? { kind: 'text', label: dentist } : null,
      {
        amount: amount && currency ? lookups.money(amount, currency) : '',
        month: lookups.month(text(after.month) ?? ''),
        action: readableAction(action),
      },
    );
  }

  // --- Expenses (feature 17): the category, or the fixed expense, is named in the snapshot ---
  if (
    prefix === 'expense' ||
    prefix === 'expense_category' ||
    prefix === 'fixed_expense' ||
    prefix === 'fixed_expense_item'
  ) {
    const key = field(entry, 'categoryKey');
    const category = key
      ? lookups.label('expenseCategory', key)
      : (text(after.name) ?? field(entry, 'categoryName'));
    const name = prefix.startsWith('fixed_expense') ? field(entry, 'name') : category;
    const currency = field(entry, 'currency');
    const money = (value: unknown) => {
      const amount = text(value);
      return amount && currency ? lookups.money(amount, currency) : '';
    };
    const before = snapshot(entry.before);
    const repriced = action === 'expense.update' && 'amount' in after;
    return done(
      repriced ? 'expense.update_amount' : EXPENSES.has(action) ? action : 'fallback',
      name ? { kind: 'text', label: name } : null,
      {
        amount: money(after.amount ?? before.amount),
        from:
          action === 'expense_category.rename' ? (text(before.name) ?? '') : money(before.amount),
        to: money(after.amount),
        month: lookups.month(field(entry, 'month') ?? ''),
        action: readableAction(action),
      },
    );
  }

  // --- Payroll (feature 17): the employee is named in the snapshot ---
  if (prefix === 'employee' || prefix === 'employee_salary' || prefix === 'payroll_line') {
    const employee = field(entry, 'employee');
    const currency = field(entry, 'currency');
    const money = (value: unknown) => {
      const amount = text(value);
      return amount && currency ? lookups.money(amount, currency) : '';
    };
    const salarySet = action === 'employee_salary.change' && text(after.from) === null;
    return done(
      salarySet ? 'employee_salary.set' : PAYROLL.has(action) ? action : 'fallback',
      employee ? { kind: 'text', label: employee } : null,
      {
        amount: money(after.amount),
        from: money(after.from),
        to: money(after.to),
        month: lookups.month(field(entry, 'month') ?? field(entry, 'effectiveMonth') ?? ''),
        action: readableAction(action),
      },
    );
  }

  // --- Labs (feature 18): a lab is named in the snapshot; an order is about the patient ---
  if (
    prefix === 'lab' ||
    prefix === 'lab_service' ||
    prefix === 'lab_payment' ||
    prefix === 'lab_adjustment'
  ) {
    const lab = field(entry, 'labName') ?? field(entry, 'name');
    const currency = field(entry, 'currency');
    const amount = text(after.amount);
    return done(LABS.has(action) ? action : 'fallback', lab ? { kind: 'text', label: lab } : null, {
      amount: amount && currency ? lookups.money(amount, currency) : '',
      service: prefix === 'lab_service' ? (text(after.name) ?? '') : '',
      action: readableAction(action),
    });
  }
  if (prefix === 'lab_order') {
    const bySystem = text(after.by) === 'system';
    return done(LABS.has(action) ? (bySystem ? `${action}_system` : action) : 'fallback', patient, {
      number: field(entry, 'number') ?? '',
      lab: field(entry, 'labName') ?? '',
      items: field(entry, 'items') ?? '',
      action: readableAction(action),
    });
  }

  // --- Inventory (feature 20a): an item, a supplier or a receipt is named in the snapshot ---
  if (prefix.startsWith('inventory_')) {
    const currency = field(entry, 'currency');
    const amount = text(after.amount) ?? text(after.total);
    const number = after.number ?? before.number;
    const receipt = typeof number === 'number' ? `GR-${String(number).padStart(6, '0')}` : null;
    const name =
      prefix === 'inventory_receipt'
        ? [receipt, field(entry, 'supplierName') ?? field(entry, 'payee')]
            .filter(Boolean)
            .join(' · ')
        : (field(entry, 'item') ??
          field(entry, 'supplierName') ??
          field(entry, 'payee') ??
          field(entry, 'name'));
    const quantity = after.quantity;
    return done(
      INVENTORY.has(action) ? action : 'fallback',
      name ? { kind: 'text', label: name } : null,
      {
        amount: amount && currency ? lookups.money(amount, currency) : '',
        quantity:
          typeof quantity === 'number'
            ? `${String(quantity)} ${field(entry, 'unit') ?? ''}`.trim()
            : '',
        level: typeof after.reorderLevel === 'number' ? String(after.reorderLevel) : '—',
        days: typeof after.expiringDays === 'number' ? String(after.expiringDays) : '',
        action: readableAction(action),
      },
    );
  }

  // --- Schedule (feature 14): about the patient; a follow-up also says what it is ---
  if (prefix === 'appointment' || prefix === 'follow_up') {
    return done(SCHEDULE.has(action) ? action : 'fallback', patient, {
      title: field(entry, 'title') ?? '',
      action: readableAction(action),
    });
  }
  if (action === 'opening_hours.update' || action === 'scheduling_settings.update') {
    return done(action, null);
  }

  // --- Visits and the clinical record ---
  if (action === 'visit.update') {
    const key =
      'notes' in after
        ? 'visit.notes'
        : 'reason' in after
          ? 'visit.reason'
          : 'painScore' in after
            ? 'visit.complaint'
            : 'visit.discount_live';
    return done(key, visit, {}, patient);
  }
  // Why the patient came, said with the start (feature 10).
  if (action === 'visit.start') {
    const type = text(after.type);
    const reason = text(after.reason);
    const values = { type: type ? lookups.label('visitType', type) : '', reason: reason ?? '' };
    return done(
      type === null ? 'visit.start' : reason ? 'visit.start_reason' : 'visit.start_type',
      visit,
      values,
      patient,
    );
  }
  // A service the visit's type added by itself (ADR-0047).
  if (action === 'visit_service.create' && after.autoAdded === true) {
    return done('visit_service.create_auto', visit, { name: recordName(entry, lookups) }, patient);
  }
  if (action === 'treatment_plan.prioritise') {
    const priority = text(after.priority);
    return done(
      action,
      patient,
      { priority: priority ? lookups.label('priority', priority) : '' },
      visit,
    );
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
  if (NAMED.has(action)) return done(action, patient, { name: recordName(entry, lookups) }, visit);
  if (PLAIN.has(action)) {
    return done(action, patient, {}, prefix === 'patient' || prefix === 'contact' ? null : visit);
  }
  return done('fallback', patient ?? visit, { action: readableAction(action) });
}
