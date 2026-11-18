import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { exportLanguageSchema, paymentMethodSchema } from './billing.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  commaSeparatedIds,
  cursorPageQuerySchema,
  cursorPageSchema,
  currencySchema,
  decimalAmountSchema,
  displayNumberSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  queryBooleanSchema,
} from './common.js';
import { positiveAmountSchema } from './compensation.js';
import { toothCodeSchema } from './tooth.js';

/**
 * Feature 18 (spec `2026-11-11-lab-orders-design.md`, ADR-0081–0086): the dental laboratories a
 * clinic works with, the lab work ordered for its patients, and what the clinic owes each lab.
 * An order is one number with a history of trips; its cost is owed from the day the work first
 * arrives; only a payment to a lab is an expense. Prices and balances (`null` here) are given only
 * to callers with `lab:money_read`.
 */

// --- Vocabulary ---

export const LAB_ORDER_STATUSES = [
  'to_send',
  'at_lab',
  'arrived',
  'done',
  'on_hold',
  'remake',
  'cancelled',
] as const;
export const labOrderStatusSchema = z.enum(LAB_ORDER_STATUSES);
export type LabOrderStatus = z.infer<typeof labOrderStatusSchema>;

/** Every status but done and cancelled: the order still needs someone. */
export const OPEN_LAB_ORDER_STATUSES = [
  'to_send',
  'at_lab',
  'arrived',
  'on_hold',
  'remake',
] as const satisfies readonly LabOrderStatus[];
export const isOpenLabOrderStatus = (status: LabOrderStatus): boolean =>
  (OPEN_LAB_ORDER_STATUSES as readonly string[]).includes(status);

/** How a lab takes cases. */
export const LAB_DELIVERY_METHODS = ['courier', 'email'] as const;
export const labDeliveryMethodSchema = z.enum(LAB_DELIVERY_METHODS);
export type LabDeliveryMethod = z.infer<typeof labDeliveryMethodSchema>;

/** How a trip left: with a courier, by email, or in the lab's own software. */
export const LAB_SENT_VIA = ['courier', 'email', 'lab_software'] as const;
export const labSentViaSchema = z.enum(LAB_SENT_VIA);
export type LabSentVia = z.infer<typeof labSentViaSchema>;

export const LAB_PRIORITIES = ['normal', 'urgent'] as const;
export const labPrioritySchema = z.enum(LAB_PRIORITIES);
export type LabPriority = z.infer<typeof labPrioritySchema>;

export const LAB_SUBMISSIONS = ['physical', 'digital'] as const;
export const labSubmissionSchema = z.enum(LAB_SUBMISSIONS);
export type LabSubmission = z.infer<typeof labSubmissionSchema>;

/** Where an item goes: listed teeth, or an arch, or both arches. */
export const LAB_ITEM_TARGETS = ['teeth', 'upper', 'lower', 'both'] as const;
export const labItemTargetSchema = z.enum(LAB_ITEM_TARGETS);
export type LabItemTarget = z.infer<typeof labItemTargetSchema>;

/** What happened to a trip's work after it arrived, when it went back (ADR-0082). */
export const LAB_TRIP_OUTCOMES = ['next_stage', 'adjustment', 'remake'] as const;
export const labTripOutcomeSchema = z.enum(LAB_TRIP_OUTCOMES);
export type LabTripOutcome = z.infer<typeof labTripOutcomeSchema>;

export const LAB_REMAKE_REASONS = ['fit', 'shade', 'fracture', 'impression', 'other'] as const;
export const labRemakeReasonSchema = z.enum(LAB_REMAKE_REASONS);
export type LabRemakeReason = z.infer<typeof labRemakeReasonSchema>;

export const LAB_REMAKE_BORNE_BY = ['lab', 'clinic'] as const;
export const labRemakeBorneBySchema = z.enum(LAB_REMAKE_BORNE_BY);
export type LabRemakeBorneBy = z.infer<typeof labRemakeBorneBySchema>;

export const LAB_ADJUSTMENT_KINDS = ['credit', 'charge'] as const;
export const labAdjustmentKindSchema = z.enum(LAB_ADJUSTMENT_KINDS);
export type LabAdjustmentKind = z.infer<typeof labAdjustmentKindSchema>;

/** The marks that can be taken one step back (ADR-0082). */
export const LAB_UNDO_STEPS = ['sent', 'received', 'done', 'outcome', 'cancel'] as const;
export const labUndoStepSchema = z.enum(LAB_UNDO_STEPS);
export type LabUndoStep = z.infer<typeof labUndoStepSchema>;

/** The stored `LabPayment*` events: money rows of the audit log (ADR-0086). */
export const LAB_MONEY_EVENTS = ['LabPaymentRecorded', 'LabPaymentVoided'] as const;

export const LAB_NAME_MAX = 80;
export const LAB_TURNAROUND_MAX = 365;
export const LAB_ORDER_ITEMS_MAX = 20;
export const LAB_RECEIVE_BATCH_MAX = 50;

/** `L-000123`, in the style of visit numbers. */
export function formatLabOrderNumber(value: number): string {
  return `L-${String(value).padStart(6, '0')}`;
}

/** `L-000123`, `L-123`, `l123` or `123` → 123; anything else → null. */
export function parseLabOrderNumber(text: string): number | null {
  const match = /^\s*(?:l-?)?0*(\d{1,9})\s*$/i.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

const nonNegativeAmountSchema = decimalAmountSchema.refine(
  (amount) => !amount.startsWith('-') || /^-0+(\.0+)?$/.test(amount),
  'Must not be negative',
);
const turnaroundSchema = z.number().int().min(1).max(LAB_TURNAROUND_MAX);
const urlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, 'Expected a link starting with http:// or https://');
const optionalUrl = urlSchema
  .nullish()
  .or(z.literal(''))
  .transform((value) => (value ? value : null));
const labNameSchema = z.string().trim().min(1).max(LAB_NAME_MAX);

// --- Labs and their services ---

export const labServiceSchema = z.object({
  id: idSchema,
  labId: idSchema,
  name: z.string(),
  /** Null without `lab:money_read`. */
  price: decimalAmountSchema.nullable(),
  currency: currencySchema,
  /** Overrides the lab's standard turnaround for this service. */
  turnaroundDays: z.number().int().nullable(),
  active: z.boolean(),
});
export type LabService = z.infer<typeof labServiceSchema>;

export const labSchema = z.object({
  id: idSchema,
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  deliveryMethods: z.array(labDeliveryMethodSchema),
  portalUrl: z.string().nullable(),
  turnaroundDays: z.number().int(),
  note: z.string().nullable(),
  active: z.boolean(),
  services: z.array(labServiceSchema),
  /** Null without `lab:money_read`, or when none was set. */
  openingBalance: decimalAmountSchema.nullable(),
  openingBalanceOn: isoDateSchema.nullable(),
});
export type Lab = z.infer<typeof labSchema>;

const labFields = {
  name: labNameSchema,
  contactPerson: optionalText(120),
  phone: optionalText(40),
  email: optionalText(200),
  address: optionalText(300),
  deliveryMethods: z
    .array(labDeliveryMethodSchema)
    .min(1, 'Choose at least one delivery method')
    .transform((methods) => [...new Set(methods)]),
  portalUrl: optionalUrl,
  turnaroundDays: turnaroundSchema,
  note: optionalText(1000),
};

export const createLabSchema = z.object(labFields);
export type CreateLab = z.infer<typeof createLabSchema>;

export const updateLabSchema = z
  .object(labFields)
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateLab = z.infer<typeof updateLabSchema>;

export const createLabServiceSchema = z.object({
  name: labNameSchema,
  price: nonNegativeAmountSchema,
  turnaroundDays: turnaroundSchema.nullish().transform((value) => value ?? null),
});
export type CreateLabService = z.infer<typeof createLabServiceSchema>;

export const updateLabServiceSchema = createLabServiceSchema
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateLabService = z.infer<typeof updateLabServiceSchema>;

export const labListQuerySchema = z.object({
  includeInactive: blankToUndefined(queryBooleanSchema),
});
export type LabListQuery = z.infer<typeof labListQuerySchema>;

// --- Orders ---

export const labOrderItemInputSchema = z
  .object({
    /** A service of the order's lab; null for a free-text item. */
    serviceId: idSchema.nullish().transform((value) => value ?? null),
    /** Required for a free-text item; ignored with a service (its name is kept). */
    description: optionalText(200),
    quantity: z.number().int().min(1).max(99).default(1),
    shade: optionalText(20),
    target: labItemTargetSchema,
    teeth: z
      .array(toothCodeSchema)
      .max(32)
      .default([])
      .transform((teeth) => [...new Set(teeth)]),
  })
  .refine((item) => item.serviceId !== null || item.description !== null, {
    message: 'Choose a service or describe the item',
    path: ['description'],
  })
  .refine((item) => (item.target === 'teeth') === item.teeth.length > 0, {
    message: 'List the teeth, or choose an arch',
    path: ['teeth'],
  });
export type LabOrderItemInput = z.infer<typeof labOrderItemInputSchema>;

const orderFields = {
  dentistId: idSchema,
  labId: idSchema,
  branchId: idSchema,
  items: z.array(labOrderItemInputSchema).min(1).max(LAB_ORDER_ITEMS_MAX),
  priority: labPrioritySchema.default('normal'),
  submission: labSubmissionSchema.default('physical'),
  labCaseRef: optionalText(100),
  labCaseUrl: optionalUrl,
  /** Defaults to the longest item turnaround, else the lab's standard. */
  expectedDays: turnaroundSchema.nullish().transform((value) => value ?? null),
  notes: optionalText(2000),
  planIds: z
    .array(idSchema)
    .max(50)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  /** Only with `lab:money_manage`; otherwise the estimate from the items' prices. */
  cost: nonNegativeAmountSchema.nullish().transform((value) => value ?? null),
};

export const createLabOrderSchema = z.object({
  patientId: idSchema,
  visitId: idSchema.nullish().transform((value) => value ?? null),
  /** The appointment the work is needed for; omitted = none. */
  appointmentId: idSchema.nullish().transform((value) => value ?? null),
  fileIds: z
    .array(idSchema)
    .max(20)
    .default([])
    .transform((ids) => [...new Set(ids)]),
  ...orderFields,
});
export type CreateLabOrder = z.infer<typeof createLabOrderSchema>;

export const updateLabOrderSchema = z
  .object({
    dentistId: orderFields.dentistId,
    labId: orderFields.labId,
    branchId: orderFields.branchId,
    items: orderFields.items,
    priority: labPrioritySchema,
    submission: labSubmissionSchema,
    labCaseRef: orderFields.labCaseRef,
    labCaseUrl: orderFields.labCaseUrl,
    expectedDays: turnaroundSchema,
    notes: orderFields.notes,
    planIds: orderFields.planIds,
    cost: nonNegativeAmountSchema,
  })
  .partial();
export type UpdateLabOrder = z.infer<typeof updateLabOrderSchema>;

export const sendLabOrderSchema = z.object({
  sentOn: isoDateSchema,
  via: labSentViaSchema,
  reference: optionalText(100),
});
export type SendLabOrder = z.infer<typeof sendLabOrderSchema>;

export const receiveLabOrdersSchema = z.object({
  orderIds: z
    .array(idSchema)
    .min(1)
    .max(LAB_RECEIVE_BATCH_MAX)
    .transform((ids) => [...new Set(ids)]),
  receivedOn: isoDateSchema,
  note: optionalText(500),
});
export type ReceiveLabOrders = z.infer<typeof receiveLabOrdersSchema>;

export const expectedLabOrderSchema = z.object({ expectedOn: isoDateSchema });
export type ExpectedLabOrder = z.infer<typeof expectedLabOrderSchema>;

export const LAB_OUTCOME_CHOICES = ['fitted', ...LAB_TRIP_OUTCOMES] as const;
export type LabOutcomeChoice = (typeof LAB_OUTCOME_CHOICES)[number];

/**
 * What became of arrived work (B4, B6): fitted, back to the lab for the next stage or an
 * adjustment, or a remake with its reason and who bears it.
 */
export const labOutcomeSchema = z
  .object({
    choice: z.enum(LAB_OUTCOME_CHOICES),
    note: optionalText(500),
    reason: labRemakeReasonSchema.nullish().transform((value) => value ?? null),
    borneBy: labRemakeBorneBySchema.nullish().transform((value) => value ?? null),
    /** What the clinic pays for a clinic-borne remake; ignored otherwise. */
    charge: nonNegativeAmountSchema.nullish().transform((value) => value ?? null),
  })
  .refine(
    (value) => value.choice !== 'remake' || (value.reason !== null && value.borneBy !== null),
    {
      message: 'Say why the work is remade and who bears it',
      path: ['reason'],
    },
  );
export type LabOutcome = z.infer<typeof labOutcomeSchema>;

export const holdLabOrderSchema = z.object({ reason: reasonSchema });
export type HoldLabOrder = z.infer<typeof holdLabOrderSchema>;

export const cancelLabOrderSchema = z.object({
  reason: reasonSchema,
  /** What the lab still charges for work sent and never delivered (default 0). */
  charge: nonNegativeAmountSchema.nullish().transform((value) => value ?? null),
});
export type CancelLabOrder = z.infer<typeof cancelLabOrderSchema>;

export const undoLabOrderSchema = z.object({ step: labUndoStepSchema });
export type UndoLabOrder = z.infer<typeof undoLabOrderSchema>;

export const linkLabOrderSchema = z.object({ appointmentId: idSchema.nullable() });
export type LinkLabOrder = z.infer<typeof linkLabOrderSchema>;

export const labOrderAttachmentsSchema = z.object({
  fileIds: z
    .array(idSchema)
    .max(20)
    .transform((ids) => [...new Set(ids)]),
});
export type LabOrderAttachments = z.infer<typeof labOrderAttachmentsSchema>;

export const correctLabTripSchema = z
  .object({ sentOn: isoDateSchema.optional(), receivedOn: isoDateSchema.optional() })
  .refine((value) => value.sentOn !== undefined || value.receivedOn !== undefined, {
    message: 'Nothing to correct',
  });
export type CorrectLabTrip = z.infer<typeof correctLabTripSchema>;

// --- The label (C1) ---

/** An order at the lab is *due soon* — its label, Today's lane — this many days before it is expected. */
export const LAB_EXPECTED_SOON_DAYS = 3;

export const LAB_LABEL_KINDS = [
  'to_send',
  'at_lab',
  'due_soon',
  'late',
  'arrived',
  'on_hold',
  'remake',
] as const;
export type LabLabelKind = (typeof LAB_LABEL_KINDS)[number];

/** The calendar mark's colour (C1). */
export const LAB_LABEL_TONES = ['on_track', 'at_risk', 'late', 'arrived'] as const;
export type LabLabelTone = (typeof LAB_LABEL_TONES)[number];

export const labOrderLabelSchema = z.object({
  kind: z.enum(LAB_LABEL_KINDS),
  /** At the lab: the expected date. */
  due: isoDateSchema.nullable(),
  /** Late: whole days past the expected date. */
  daysLate: z.number().int().nullable(),
  /** Due soon: whole days until the expected date (0 is today). */
  daysLeft: z.number().int().nullable(),
  tone: z.enum(LAB_LABEL_TONES),
  /** 0 is the most urgent: the one shown with a count when there are several. */
  urgency: z.number().int(),
});
export type LabOrderLabel = z.infer<typeof labOrderLabelSchema>;

const URGENCY: Readonly<Record<LabLabelKind, number>> = {
  late: 0,
  due_soon: 1,
  remake: 2,
  to_send: 3,
  on_hold: 4,
  at_lab: 5,
  arrived: 6,
};

/** Whole days from `from` to `to` (ISO dates). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `date` plus `days` calendar days (ISO dates). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The one label an open order shows everywhere (C1), from its status, its expected date and its
 * appointment's day, on `today` in the clinic's time zone. Null for a done or cancelled order.
 * An order is late when it is at the lab past its expected date (B3); on hold is never late. At
 * the lab and expected within `LAB_EXPECTED_SOON_DAYS`, it is due soon.
 */
export function labOrderLabel(
  order: { status: LabOrderStatus; expectedOn: string | null; appointmentDate: string | null },
  today: string,
): LabOrderLabel | null {
  const { status, expectedOn, appointmentDate } = order;
  if (status === 'done' || status === 'cancelled') return null;
  const at = (kind: LabLabelKind, tone: LabLabelTone, extra: Partial<LabOrderLabel> = {}) => ({
    kind,
    due: null,
    daysLate: null,
    daysLeft: null,
    tone,
    urgency: URGENCY[kind],
    ...extra,
  });
  if (status === 'arrived') return at('arrived', 'arrived');
  if (status === 'at_lab' && expectedOn !== null) {
    if (today > expectedOn) {
      return at('late', 'late', { due: expectedOn, daysLate: daysBetween(expectedOn, today) });
    }
    const risky = appointmentDate !== null && appointmentDate <= expectedOn;
    const daysLeft = daysBetween(today, expectedOn);
    return daysLeft <= LAB_EXPECTED_SOON_DAYS
      ? at('due_soon', risky ? 'at_risk' : 'on_track', { due: expectedOn, daysLeft })
      : at('at_lab', risky ? 'at_risk' : 'on_track', { due: expectedOn });
  }
  const kind: LabLabelKind = status === 'at_lab' ? 'at_lab' : status;
  return at(kind, 'at_risk');
}

/** The most urgent of several labels (C1), or null when there is none. */
export function mostUrgentLabel(labels: readonly (LabOrderLabel | null)[]): LabOrderLabel | null {
  let best: LabOrderLabel | null = null;
  for (const label of labels) {
    if (label && (best === null || label.urgency < best.urgency)) best = label;
  }
  return best;
}

// --- Order reads ---

export const labOrderItemSchema = z.object({
  id: idSchema,
  serviceId: idSchema.nullable(),
  description: z.string(),
  /** The price when ordered; null without `lab:money_read` or for a free-text item. */
  unitPrice: decimalAmountSchema.nullable(),
  turnaroundDays: z.number().int().nullable(),
  quantity: z.number().int(),
  shade: z.string().nullable(),
  target: labItemTargetSchema,
  teeth: z.array(toothCodeSchema),
});
export type LabOrderItem = z.infer<typeof labOrderItemSchema>;

export const labOrderTripSchema = z.object({
  seq: z.number().int().positive(),
  sentOn: isoDateSchema,
  sentVia: labSentViaSchema,
  sentReference: z.string().nullable(),
  /** The date promised at sending: what the lab is judged on (O3). */
  promisedOn: isoDateSchema,
  /** The date the clinic plans around; moved by a new expected date. */
  expectedOn: isoDateSchema,
  receivedOn: isoDateSchema.nullable(),
  receivedNote: z.string().nullable(),
  outcome: labTripOutcomeSchema.nullable(),
  outcomeNote: z.string().nullable(),
  outcomeOn: isoDateSchema.nullable(),
  remakeReason: labRemakeReasonSchema.nullable(),
  remakeBorneBy: labRemakeBorneBySchema.nullable(),
  /** Null without `lab:money_read`. */
  remakeCharge: decimalAmountSchema.nullable(),
});
export type LabOrderTrip = z.infer<typeof labOrderTripSchema>;

export const labAppointmentRefSchema = z.object({
  id: idSchema,
  startsAt: isoDateTimeSchema,
  localDate: isoDateSchema,
  dentistName: z.string(),
  status: z.string(),
});
export type LabAppointmentRef = z.infer<typeof labAppointmentRefSchema>;

/** One order as lists, labels, the lane and the booking warning need it. */
export const labOrderSummarySchema = z.object({
  id: idSchema,
  displayNumber: z.number().int().positive(),
  patient: z.object({ id: idSchema, fullName: z.string(), displayNumber: displayNumberSchema }),
  dentistId: idSchema,
  dentistName: z.string(),
  labId: idSchema,
  labName: z.string(),
  labPhone: z.string().nullable(),
  branchId: idSchema,
  visitId: idSchema.nullable(),
  appointment: labAppointmentRefSchema.nullable(),
  status: labOrderStatusSchema,
  priority: labPrioritySchema,
  submission: labSubmissionSchema,
  items: z.array(labOrderItemSchema),
  /** The treatment plan items the work is for (the next appointment takes them on). */
  planIds: z.array(idSchema),
  expectedDays: z.number().int(),
  /** The current (last) trip's dates; null before the first one. */
  sentOn: isoDateSchema.nullable(),
  expectedOn: isoDateSchema.nullable(),
  promisedOn: isoDateSchema.nullable(),
  receivedOn: isoDateSchema.nullable(),
  firstReceivedOn: isoDateSchema.nullable(),
  /** The day it started waiting to be sent: created, or last sent back. */
  waitingSince: isoDateSchema,
  tripCount: z.number().int().nonnegative(),
  label: labOrderLabelSchema.nullable(),
  /** Null without `lab:money_read`. */
  cost: decimalAmountSchema.nullable(),
  currency: currencySchema,
  createdAt: isoDateTimeSchema,
});
export type LabOrderSummary = z.infer<typeof labOrderSummarySchema>;

export const labOrderFileSchema = z.object({
  id: idSchema,
  originalFilename: z.string(),
  kind: z.string(),
});
export type LabOrderFile = z.infer<typeof labOrderFileSchema>;

export const labOrderSchema = labOrderSummarySchema.extend({
  visitNumber: z.number().int().nullable(),
  labCaseRef: z.string().nullable(),
  labCaseUrl: z.string().nullable(),
  notes: z.string().nullable(),
  trips: z.array(labOrderTripSchema),
  files: z.array(labOrderFileSchema),
  heldFrom: labOrderStatusSchema.nullable(),
  cancelledFrom: labOrderStatusSchema.nullable(),
  cancelReason: z.string().nullable(),
  cancelledOn: isoDateSchema.nullable(),
  /** Null without `lab:money_read`. */
  cancelCharge: decimalAmountSchema.nullable(),
  doneOn: isoDateSchema.nullable(),
  costSetByHand: z.boolean(),
  /** The undo steps open to this order now. */
  undoable: z.array(labUndoStepSchema),
});
export type LabOrder = z.infer<typeof labOrderSchema>;

/** Lab work the next appointment may be for, and the first day it can be fitted. */
export interface LabWorkForNextAppointment {
  order: LabOrderSummary;
  /** Sent and not back: the current trip's expected date is the one to wait for. */
  atLab: boolean;
  /** Arrived: the visit's day. At the lab: its expected date, never before the visit's day. Not
   * sent yet, or sent back: the visit's day plus the expected wait, since it cannot leave before
   * today. */
  readyOn: string;
}

/**
 * The lab work a visit's next appointment may be for (feature 18): the patient's open orders that
 * no other appointment is waiting for, soonest ready first. An order linked to this visit's own
 * appointment counts: that appointment is ending, and completing it removes the link (ADR-0084).
 */
export function labWorkForNextAppointment(
  orders: readonly LabOrderSummary[],
  visit: { patientId: string; appointmentId: string | null; localDate: string },
): LabWorkForNextAppointment[] {
  return orders
    .filter(
      (order) =>
        order.patient.id === visit.patientId &&
        isOpenLabOrderStatus(order.status) &&
        (order.appointment === null || order.appointment.id === visit.appointmentId),
    )
    .map((order) => {
      // The dates are the last trip's: work sent back keeps the old trip's, long past.
      const atLab = order.sentOn !== null && order.receivedOn === null && order.expectedOn !== null;
      const expected =
        order.status === 'arrived'
          ? visit.localDate
          : atLab && order.expectedOn
            ? order.expectedOn
            : addDays(visit.localDate, order.expectedDays);
      return { order, atLab, readyOn: expected < visit.localDate ? visit.localDate : expected };
    })
    .sort(
      (a, b) => a.readyOn.localeCompare(b.readyOn) || a.order.displayNumber - b.order.displayNumber,
    );
}

export const labOrderListQuerySchema = cursorPageQuerySchema.extend({
  status: blankToUndefined(z.union([labOrderStatusSchema, z.literal('open')]).optional()),
  labId: blankToUndefined(idSchema.optional()),
  dentistId: blankToUndefined(idSchema.optional()),
  branchId: blankToUndefined(idSchema.optional()),
  patientId: blankToUndefined(idSchema.optional()),
  late: blankToUndefined(queryBooleanSchema),
  /** The period, on the day the order was created. */
  from: blankToUndefined(isoDateSchema.optional()),
  to: blankToUndefined(isoDateSchema.optional()),
  q: blankToUndefined(z.string().trim().max(100).optional()),
  /** The orders behind a report figure. */
  ids: blankToUndefined(commaSeparatedIds(500).optional()),
});
export type LabOrderListQuery = z.infer<typeof labOrderListQuerySchema>;

export const labOrderExportQuerySchema = labOrderListQuerySchema
  .omit({ cursor: true, limit: true })
  .extend({ lang: blankToUndefined(exportLanguageSchema.optional()) });
export type LabOrderExportQuery = z.infer<typeof labOrderExportQuerySchema>;

export const labOrderPageSchema = cursorPageSchema(labOrderSummarySchema);
export type LabOrderPage = z.infer<typeof labOrderPageSchema>;

export const labOpenOrdersSchema = z.array(labOrderSummarySchema);

export const labProposalQuerySchema = z.object({
  patientId: idSchema,
  dentistId: blankToUndefined(idSchema.optional()),
});
export type LabProposalQuery = z.infer<typeof labProposalQuerySchema>;

export const labProposalSchema = z.object({
  appointment: labAppointmentRefSchema.nullable(),
  /** The patient's upcoming appointments, for the picker. */
  upcoming: z.array(labAppointmentRefSchema),
});
export type LabProposal = z.infer<typeof labProposalSchema>;

// --- Today (C3) ---

/**
 * Why an order is on Today's Lab work lane, most urgent first: late; needed for an appointment
 * today or on the next open day; not sent yet; expected from the lab within
 * `LAB_EXPECTED_SOON_DAYS`; arrived with no appointment booked.
 */
export const LAB_TODAY_REASONS = ['late', 'due', 'not_sent', 'expected', 'book'] as const;
export const labTodayReasonSchema = z.enum(LAB_TODAY_REASONS);
export type LabTodayReason = z.infer<typeof labTodayReasonSchema>;

export const labTodayQuerySchema = z.object({ branchId: idSchema });

export const labTodaySchema = z.object({
  date: isoDateSchema,
  nextOpenDay: isoDateSchema,
  rows: z.array(z.object({ reason: labTodayReasonSchema, order: labOrderSummarySchema })),
});
export type LabToday = z.infer<typeof labTodaySchema>;

// --- Money (Part D) ---

export const labOpeningBalanceSchema = z.object({
  /** What the clinic already owed; negative when the clinic was in credit. */
  amount: decimalAmountSchema,
  asOf: isoDateSchema,
});
export type LabOpeningBalance = z.infer<typeof labOpeningBalanceSchema>;

export const recordLabPaymentSchema = z.object({
  paidOn: isoDateSchema,
  amount: positiveAmountSchema,
  method: paymentMethodSchema,
  reference: optionalText(100),
  note: optionalText(500),
});
export type RecordLabPayment = z.infer<typeof recordLabPaymentSchema>;

export const labPaymentSchema = z.object({
  id: idSchema,
  labId: idSchema,
  paidOn: isoDateSchema,
  amount: decimalAmountSchema,
  currency: currencySchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type LabPayment = z.infer<typeof labPaymentSchema>;

export const voidLabPaymentSchema = z.object({ reason: reasonSchema });
export type VoidLabPayment = z.infer<typeof voidLabPaymentSchema>;

export const recordLabAdjustmentSchema = z.object({
  onDate: isoDateSchema,
  kind: labAdjustmentKindSchema,
  amount: positiveAmountSchema,
  reason: reasonSchema,
});
export type RecordLabAdjustment = z.infer<typeof recordLabAdjustmentSchema>;

export const labAdjustmentSchema = z.object({
  id: idSchema,
  labId: idSchema,
  onDate: isoDateSchema,
  kind: labAdjustmentKindSchema,
  amount: decimalAmountSchema,
  currency: currencySchema,
  reason: z.string(),
  createdAt: isoDateTimeSchema,
});
export type LabAdjustment = z.infer<typeof labAdjustmentSchema>;

const accountFigures = {
  /** Opening balance, delivered orders, charges and adjustments. */
  owed: aggregateAmountSchema,
  /** Live payments. */
  paid: aggregateAmountSchema,
  /** Owed minus paid; negative when the clinic is in credit. */
  outstanding: aggregateAmountSchema,
  inProgressCount: z.number().int().nonnegative(),
  inProgressAmount: aggregateAmountSchema,
};

export const labAccountSchema = z.object({
  labId: idSchema,
  labName: z.string(),
  active: z.boolean(),
  ...accountFigures,
});
export type LabAccount = z.infer<typeof labAccountSchema>;

export const labAccountsSchema = z.object({
  currency: currencySchema,
  labs: z.array(labAccountSchema),
  total: z.object(accountFigures),
});
export type LabAccounts = z.infer<typeof labAccountsSchema>;

export const LAB_STATEMENT_KINDS = [
  'opening',
  'order',
  'remake',
  'cancellation',
  'adjustment',
  'payment',
] as const;
export type LabStatementKind = (typeof LAB_STATEMENT_KINDS)[number];

export const labStatementLineSchema = z.object({
  date: isoDateSchema,
  kind: z.enum(LAB_STATEMENT_KINDS),
  /** The order, adjustment or payment the line comes from; the lab for the opening balance. */
  sourceId: idSchema,
  orderNumber: z.number().int().nullable(),
  patientName: z.string().nullable(),
  /** The items, the reason, the payment's reference. */
  description: z.string().nullable(),
  adjustmentKind: labAdjustmentKindSchema.nullable(),
  method: paymentMethodSchema.nullable(),
  /** Positive adds to what the clinic owes; a payment or a credit is negative. */
  amount: aggregateAmountSchema,
  /** After this line; a voided payment changes nothing and keeps the balance before it. */
  balance: aggregateAmountSchema,
  voided: z.boolean(),
  voidReason: z.string().nullable(),
});
export type LabStatementLine = z.infer<typeof labStatementLineSchema>;

export const labStatementQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export type LabStatementQuery = z.infer<typeof labStatementQuerySchema>;

export const labStatementSchema = z.object({
  lab: z.object({ id: idSchema, name: z.string() }),
  from: isoDateSchema,
  to: isoDateSchema,
  currency: currencySchema,
  /** The balance at the start of `from`. */
  balanceBefore: aggregateAmountSchema,
  lines: z.array(labStatementLineSchema),
  balanceAfter: aggregateAmountSchema,
});
export type LabStatement = z.infer<typeof labStatementSchema>;

// --- Reports (Part E) ---

export const LAB_REPORT_GROUPS = ['lab', 'dentist', 'service'] as const;
export type LabReportGroup = (typeof LAB_REPORT_GROUPS)[number];

export const labReportQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  groupBy: blankToUndefined(z.enum(LAB_REPORT_GROUPS).default('lab')),
});
export type LabReportQuery = z.infer<typeof labReportQuerySchema>;

const idsSchema = z.array(idSchema);

export const labReportFiguresSchema = z.object({
  sent: z.number().int(),
  received: z.number().int(),
  done: z.number().int(),
  cancelled: z.number().int(),
  /** Days from sent to received, per trip received in the period. */
  avgTurnaroundDays: z.number().nullable(),
  /** Share (0–1) of trips received on or before the promised date. */
  onTimeRate: z.number().nullable(),
  /** Days late, among the trips received late. */
  avgDelayDays: z.number().nullable(),
  /** Orders with a remake among orders received. */
  remakeRate: z.number().nullable(),
  remakeLabRate: z.number().nullable(),
  remakeClinicRate: z.number().nullable(),
  adjustmentRate: z.number().nullable(),
  /** Null without `lab:money_read`. */
  totalCost: aggregateAmountSchema.nullable(),
  avgCost: aggregateAmountSchema.nullable(),
  /** The orders behind each figure. */
  orderIds: z.object({
    sent: idsSchema,
    received: idsSchema,
    done: idsSchema,
    cancelled: idsSchema,
    late: idsSchema,
    remakes: idsSchema,
    adjustments: idsSchema,
    delivered: idsSchema,
  }),
});
export type LabReportFigures = z.infer<typeof labReportFiguresSchema>;

export const labReportSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  groupBy: z.enum(LAB_REPORT_GROUPS),
  currency: currencySchema,
  rows: z.array(z.object({ key: z.string(), name: z.string(), figures: labReportFiguresSchema })),
  total: labReportFiguresSchema,
});
export type LabReport = z.infer<typeof labReportSchema>;

// --- Request bodies as the SPA builds them (before defaults and transforms) ---

export type CreateLabRequest = z.input<typeof createLabSchema>;
export type UpdateLabRequest = z.input<typeof updateLabSchema>;
export type CreateLabServiceRequest = z.input<typeof createLabServiceSchema>;
export type UpdateLabServiceRequest = z.input<typeof updateLabServiceSchema>;
export type CreateLabOrderRequest = z.input<typeof createLabOrderSchema>;
export type UpdateLabOrderRequest = z.input<typeof updateLabOrderSchema>;
export type LabOutcomeRequest = z.input<typeof labOutcomeSchema>;
export type CancelLabOrderRequest = z.input<typeof cancelLabOrderSchema>;
export type RecordLabPaymentRequest = z.input<typeof recordLabPaymentSchema>;
export type SendLabOrderRequest = z.input<typeof sendLabOrderSchema>;
export type ReceiveLabOrdersRequest = z.input<typeof receiveLabOrdersSchema>;
