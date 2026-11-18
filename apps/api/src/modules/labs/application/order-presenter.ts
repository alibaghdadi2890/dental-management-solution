import {
  isOpenLabOrderStatus,
  type LabAppointmentRef,
  type LabOrder,
  labOrderLabel,
  type LabOrderSummary,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { VisitFactsService } from '../../clinical';
import { FilesService } from '../../files';
import { PatientsService } from '../../patients';
import { type AppointmentRef, AppointmentsService } from '../../scheduling';
import { UsersService } from '../../users';
import { type UndoFacts, undoableSteps } from '../domain/order-status';
import { LabsRepository } from '../persistence/labs.repository';
import {
  OrdersRepository,
  type StoredItem,
  type StoredOrder,
  type StoredTrip,
} from '../persistence/orders.repository';
import { LabCalendar } from './lab-calendar';

/** The facts one batch of summaries was built from, for the callers that need more (the lane). */
export interface PresentedBatch {
  summaries: LabOrderSummary[];
  appointments: Map<string, AppointmentRef>;
  today: string;
}

const ACTIVE = new Set(['booked', 'confirmed', 'checked_in', 'in_room']);

/** An appointment that still lies ahead: active and on or after today (D4). */
export const isUpcoming = (ref: AppointmentRef | undefined, today: string): boolean =>
  ref !== undefined && ACTIVE.has(ref.status) && ref.localDate >= today;

export const toAppointmentRef = (ref: AppointmentRef): LabAppointmentRef => ({
  id: ref.id,
  startsAt: ref.startsAt.toISOString(),
  localDate: ref.localDate,
  dentistName: ref.dentistName,
  status: ref.status,
});

export const undoFacts = (order: StoredOrder, trips: readonly StoredTrip[]): UndoFacts => ({
  status: order.status,
  cancelledFrom: order.cancelledFrom,
  trips: trips.map((trip) => ({ receivedOn: trip.receivedOn, outcome: trip.outcome })),
});

/**
 * Orders to their read models, resolving names in batches through the caller's transaction.
 * Prices, costs and charges are left out (`null`) without `lab:money_read` (O8).
 */
@Injectable()
export class OrderPresenter {
  constructor(
    private readonly context: RequestContext,
    private readonly calendar: LabCalendar,
    private readonly orders: OrdersRepository,
    private readonly labs: LabsRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly appointments: AppointmentsService,
    private readonly files: FilesService,
    private readonly visits: VisitFactsService,
  ) {}

  async summaries(rows: readonly StoredOrder[]): Promise<LabOrderSummary[]> {
    return (await this.batch(rows)).summaries;
  }

  async batch(rows: readonly StoredOrder[]): Promise<PresentedBatch> {
    const today = await this.calendar.today();
    if (rows.length === 0) return { summaries: [], appointments: new Map(), today };
    const ids = rows.map((row) => row.id);
    const unique = <T>(values: T[]) => [...new Set(values)];
    const [items, trips, labs, patients, dentists, appointments] = await Promise.all([
      this.orders.items(ids),
      this.orders.trips(ids),
      this.labs.byIds(unique(rows.map((row) => row.labId))),
      this.patients.refs(unique(rows.map((row) => row.patientId))),
      this.users.practitionersByProfileIds(unique(rows.map((row) => row.dentistId))),
      this.appointments.refs(
        unique(rows.flatMap((row) => (row.appointmentId ? [row.appointmentId] : []))),
      ),
    ]);
    const labById = new Map(labs.map((lab) => [lab.id, lab] as const));
    const patientById = new Map(patients.map((patient) => [patient.id, patient] as const));
    const dentistById = new Map(
      dentists.map((dentist) => [dentist.id, dentist.displayName] as const),
    );
    const appointmentById = new Map(appointments.map((ref) => [ref.id, ref] as const));
    const money = this.context.hasPermission('lab:money_read');
    const summaries = rows.map((row) => {
      const own = trips.filter((trip) => trip.orderId === row.id);
      const last = own.at(-1);
      const lab = labById.get(row.labId);
      const patient = patientById.get(row.patientId);
      const appointment = row.appointmentId ? appointmentById.get(row.appointmentId) : undefined;
      const tracked =
        isOpenLabOrderStatus(row.status) && last !== undefined && last.receivedOn === null;
      return {
        id: row.id,
        displayNumber: row.displayNumber,
        patient: {
          id: row.patientId,
          fullName: patient?.fullName ?? '',
          displayNumber: patient?.displayNumber ?? 'P-000000',
        },
        dentistId: row.dentistId,
        dentistName: dentistById.get(row.dentistId) ?? '',
        labId: row.labId,
        labName: lab?.name ?? '',
        labPhone: lab?.phone ?? null,
        branchId: row.branchId,
        visitId: row.visitId,
        appointment: appointment ? toAppointmentRef(appointment) : null,
        status: row.status,
        priority: row.priority,
        submission: row.submission,
        items: items.filter((item) => item.orderId === row.id).map((item) => toItem(item, money)),
        planIds: row.planIds,
        expectedDays: row.expectedDays,
        sentOn: last?.sentOn ?? null,
        expectedOn: last?.expectedOn ?? null,
        promisedOn: last?.promisedOn ?? null,
        receivedOn: last?.receivedOn ?? null,
        firstReceivedOn: row.firstReceivedOn,
        waitingSince: row.waitingSince,
        tripCount: own.length,
        label: labOrderLabel(
          {
            status: row.status,
            expectedOn: tracked ? last.expectedOn : null,
            appointmentDate: isUpcoming(appointment, today)
              ? (appointment?.localDate ?? null)
              : null,
          },
          today,
        ),
        cost: money ? row.cost : null,
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
      };
    });
    return { summaries, appointments: appointmentById, today };
  }

  async detail(row: StoredOrder): Promise<LabOrder> {
    const [[summary], trips, links] = await Promise.all([
      this.summaries([row]),
      this.orders.trips([row.id]),
      this.orders.files([row.id]),
    ]);
    if (!summary) throw new Error('lab order summary missing');
    const money = this.context.hasPermission('lab:money_read');
    const fileRefs = await this.files.refs(links.map((link) => link.fileId));
    const fileById = new Map(fileRefs.map((file) => [file.id, file] as const));
    const visitNumber =
      row.visitId && this.context.hasPermission('visit:read')
        ? ((await this.visits.numbersFor([row.visitId]))[0]?.displayNumber ?? null)
        : null;
    return {
      ...summary,
      visitNumber,
      labCaseRef: row.labCaseRef,
      labCaseUrl: row.labCaseUrl,
      notes: row.notes,
      trips: trips.map((trip) => ({
        seq: trip.seq,
        sentOn: trip.sentOn,
        sentVia: trip.sentVia,
        sentReference: trip.sentReference,
        promisedOn: trip.promisedOn,
        expectedOn: trip.expectedOn,
        receivedOn: trip.receivedOn,
        receivedNote: trip.receivedNote,
        outcome: trip.outcome,
        outcomeNote: trip.outcomeNote,
        outcomeOn: trip.outcomeOn,
        remakeReason: trip.remakeReason,
        remakeBorneBy: trip.remakeBorneBy,
        remakeCharge: money ? trip.remakeCharge : null,
      })),
      files: links.flatMap((link) => {
        const file = fileById.get(link.fileId);
        return file && !file.archived
          ? [{ id: file.id, originalFilename: file.originalFilename, kind: file.kind }]
          : [];
      }),
      heldFrom: row.heldFrom,
      cancelledFrom: row.cancelledFrom,
      cancelReason: row.cancelReason,
      cancelledOn: row.cancelledOn,
      cancelCharge: money ? row.cancelCharge : null,
      doneOn: row.doneOn,
      costSetByHand: row.costSetByHand,
      undoable: undoableSteps(undoFacts(row, trips)),
    };
  }
}

function toItem(item: StoredItem, money: boolean) {
  return {
    id: item.id,
    serviceId: item.serviceId,
    description: item.description,
    unitPrice: money ? item.unitPrice : null,
    turnaroundDays: item.turnaroundDays,
    quantity: item.quantity,
    shade: item.shade,
    target: item.target,
    teeth: item.teeth as LabOrderSummary['items'][number]['teeth'],
  };
}
