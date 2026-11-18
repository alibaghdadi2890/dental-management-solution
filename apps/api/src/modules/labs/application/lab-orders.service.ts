import {
  type CancelLabOrder,
  type CorrectLabTrip,
  type CreateLabOrder,
  type ExpectedLabOrder,
  fromCents,
  type HoldLabOrder,
  type LabOrder,
  type LabOrderAttachments,
  type LabOrderItemInput,
  type LabOutcome,
  type LinkLabOrder,
  type ReceiveLabOrders,
  type SendLabOrder,
  toCents,
  type UndoLabOrder,
  type UpdateLabOrder,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { VisitFactsService } from '../../clinical';
import { FilesService } from '../../files';
import { PatientsService } from '../../patients';
import { AppointmentsService } from '../../scheduling';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { defaultExpectedDays, expectedOn, shiftTripDates, teethFor } from '../domain/lab-dates';
import {
  LabAppointmentInvalidError,
  LabDateOrderError,
  LabIdempotencyMismatchError,
  LabInactiveError,
  LabNotFoundError,
  LabOrderClosedError,
  LabOrderLabLockedError,
  LabOrderNotFoundError,
  LabOrderReferenceError,
  LabServiceInactiveError,
  PatientHasOpenLabOrdersError,
} from '../domain/lab-errors';
import {
  assertCan,
  cancelTakesCharge,
  canDo,
  requireUndoPlan,
  statusAfterOutcome,
} from '../domain/order-status';
import { LabsRepository, type StoredLab } from '../persistence/labs.repository';
import {
  type NewItem,
  type OrderPatch,
  OrdersRepository,
  type StoredOrder,
  type StoredTrip,
} from '../persistence/orders.repository';
import { LabCalendar } from './lab-calendar';
import { isUpcoming, OrderPresenter, undoFacts } from './order-presenter';
import { itemsText } from './presenter';

type LinkCause = 'user' | 'booked' | 'rescheduled' | 'cancelled' | 'no_show' | 'completed';

const number = (order: StoredOrder) => `L-${String(order.displayNumber).padStart(6, '0')}`;

/**
 * Lab orders (feature 18, Part B; docs/modules/labs.md): created from a visit or the patient
 * record, followed trip by trip until the work is fitted (ADR-0082). Every write needs `lab:manage`
 * and runs under a lock on the order; a cost, a remake charge or a cancellation charge other than
 * zero needs `lab:money_manage` too (ADR-0086). Every change is audited about the patient (and the
 * visit). The appointment link follows `scheduling`'s events in their transaction (ADR-0084).
 */
@Injectable()
export class LabOrdersService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: LabCalendar,
    private readonly presenter: OrderPresenter,
    private readonly orders: OrdersRepository,
    private readonly labs: LabsRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly tenancy: TenancyService,
    private readonly appointments: AppointmentsService,
    private readonly files: FilesService,
    private readonly visits: VisitFactsService,
  ) {}

  /** `POST /lab-orders`: a retry with the same key returns the first order. */
  create(input: CreateLabOrder, key: string): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    if (input.cost !== null) this.context.requirePermission('lab:money_manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ order: input });
      await this.orders.lockKey(key);
      const first = await this.orders.byKey(key);
      if (first) {
        if (first.idempotencyHash !== hash) {
          throw new LabIdempotencyMismatchError(
            'This Idempotency-Key was used for a different request',
          );
        }
        return this.presenter.detail(first);
      }
      const patient = await this.patients.lockForDependentWrite(input.patientId);
      await this.assertDentist(input.dentistId);
      await this.assertBranch(input.branchId);
      const lab = await this.requireActiveLab(input.labId);
      if (input.visitId !== null) await this.assertVisit(input.visitId, patient.id);
      await this.assertPlans(input.planIds, patient.id);
      await this.assertFiles(input.fileIds, patient.id);
      if (input.appointmentId !== null)
        await this.assertAppointment(input.appointmentId, patient.id);
      const items = await this.buildItems(lab, input.items);
      const today = await this.calendar.today();
      const row = await this.orders.insert({
        displayNumber: await this.orders.nextNumber(),
        patientId: patient.id,
        dentistId: input.dentistId,
        labId: lab.id,
        branchId: input.branchId,
        visitId: input.visitId,
        appointmentId: input.appointmentId,
        priority: input.priority,
        submission: input.submission,
        labCaseRef: input.submission === 'digital' ? input.labCaseRef : null,
        labCaseUrl: input.submission === 'digital' ? input.labCaseUrl : null,
        expectedDays:
          input.expectedDays ??
          defaultExpectedDays(
            lab.turnaroundDays,
            items.map((item) => item.turnaroundDays ?? null),
          ),
        notes: input.notes,
        planIds: input.planIds,
        cost: input.cost === null ? estimate(items) : fromCents(toCents(input.cost)),
        costSetByHand: input.cost !== null,
        currency: lab.currency,
        waitingSince: today,
        createdBy: this.context.requireUserId(),
        idempotencyKey: key,
        idempotencyHash: hash,
      });
      await this.orders.replaceItems(row.id, items);
      await this.orders.replaceFiles(row.id, input.fileIds);
      await this.record(row, 'lab_order.create', null, {
        number: number(row),
        labName: lab.name,
        items: itemsText(items),
        priority: row.priority,
        submission: row.submission,
        expectedDays: row.expectedDays,
        appointmentId: row.appointmentId,
      });
      return this.presenter.detail(row);
    });
  }

  /** Anything but the patient; the lab only before the first sending (Rules). */
  update(id: string, patch: UpdateLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    if (patch.cost !== undefined) this.context.requirePermission('lab:money_manage');
    return this.withOrder(id, async (order, trips) => {
      if (!canDo('edit', order.status)) throw new LabOrderClosedError('This order is closed');
      const changed: OrderPatch = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const note = (field: string, from: unknown, to: unknown) => {
        before[field] = from;
        after[field] = to;
      };
      let lab = await this.labs.byId(order.labId);
      if (patch.labId !== undefined && patch.labId !== order.labId) {
        if (trips.length > 0) {
          throw new LabOrderLabLockedError(
            'The lab of a sent order can’t change; cancel it instead',
          );
        }
        lab = await this.requireActiveLab(patch.labId);
        changed.labId = lab.id;
        note('labName', (await this.labs.byId(order.labId))?.name ?? null, lab.name);
      }
      if (!lab) throw new LabNotFoundError('No such lab');
      if (patch.dentistId !== undefined && patch.dentistId !== order.dentistId) {
        await this.assertDentist(patch.dentistId);
        changed.dentistId = patch.dentistId;
        note('dentistId', order.dentistId, patch.dentistId);
      }
      if (patch.branchId !== undefined && patch.branchId !== order.branchId) {
        await this.assertBranch(patch.branchId);
        changed.branchId = patch.branchId;
        note('branchId', order.branchId, patch.branchId);
      }
      for (const field of [
        'priority',
        'submission',
        'labCaseRef',
        'labCaseUrl',
        'expectedDays',
        'notes',
      ] as const) {
        const value = patch[field];
        if (value !== undefined && value !== order[field]) {
          Object.assign(changed, { [field]: value });
          note(field, order[field], value);
        }
      }
      if (patch.planIds !== undefined && !sameSet(patch.planIds, order.planIds)) {
        await this.assertPlans(patch.planIds, order.patientId);
        changed.planIds = patch.planIds;
        note('planIds', order.planIds, patch.planIds);
      }
      let items: NewItem[] | null = null;
      if (patch.items !== undefined) {
        items = await this.buildItems(lab, patch.items, changed.labId === undefined);
        const previous = await this.orders.items([order.id]);
        if (
          itemsText(previous) !== itemsText(items) ||
          JSON.stringify(previous.map(shape)) !== JSON.stringify(items.map(shape))
        ) {
          note('items', itemsText(previous), itemsText(items));
        } else {
          items = null;
        }
      }
      if (items) {
        await this.orders.replaceItems(order.id, items);
        if (!order.costSetByHand && patch.cost === undefined) changed.cost = estimate(items);
      }
      if (patch.cost !== undefined && toCents(patch.cost) !== toCents(order.cost)) {
        changed.cost = fromCents(toCents(patch.cost));
        changed.costSetByHand = true;
      }
      if (Object.keys(before).length === 0 && changed.cost === undefined) return order;
      const row = await this.orders.update(order.id, changed);
      if (Object.keys(before).length > 0) {
        await this.record(
          row,
          'lab_order.update',
          { number: number(row), ...before },
          { number: number(row), ...after },
        );
      }
      if (patch.cost !== undefined && toCents(patch.cost) !== toCents(order.cost)) {
        await this.record(
          row,
          'lab_order.cost',
          { number: number(row), cost: order.cost },
          { number: number(row), cost: row.cost, currency: row.currency },
        );
      }
      return row;
    });
  }

  send(id: string, input: SendLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order, trips) => {
      assertCan('send', order.status);
      await this.calendar.assertNotFuture(input.sentOn);
      const due = expectedOn(input.sentOn, order.expectedDays);
      const trip = await this.orders.insertTrip({
        orderId: order.id,
        seq: trips.length + 1,
        sentOn: input.sentOn,
        sentVia: input.via,
        sentReference: input.reference,
        promisedOn: due,
        expectedOn: due,
      });
      const row = await this.orders.update(order.id, { status: 'at_lab' });
      await this.record(
        row,
        'lab_order.send',
        { status: order.status },
        {
          number: number(row),
          status: row.status,
          trip: trip.seq,
          sentOn: trip.sentOn,
          via: trip.sentVia,
          expectedOn: trip.expectedOn,
        },
      );
      return row;
    });
  }

  /** One date for 1–50 orders: an arriving parcel is received in seconds (C2). */
  receive(input: ReceiveLabOrders): Promise<LabOrder[]> {
    this.context.requirePermission('lab:manage');
    return this.tenantDb.run(async () => {
      await this.calendar.assertNotFuture(input.receivedOn);
      const locked = await this.orders.lock(input.orderIds);
      if (locked.length !== input.orderIds.length) throw new LabOrderNotFoundError('No such order');
      const allTrips = await this.orders.trips(locked.map((order) => order.id));
      const done: StoredOrder[] = [];
      for (const id of input.orderIds) {
        const order = locked.find((candidate) => candidate.id === id) as StoredOrder;
        assertCan('receive', order.status);
        const trip = allTrips.filter((candidate) => candidate.orderId === id).at(-1);
        if (!trip) throw new LabDateOrderError('This order was never sent');
        if (input.receivedOn < trip.sentOn) {
          throw new LabDateOrderError('The work can’t arrive before it was sent', {
            sentOn: trip.sentOn,
          });
        }
        await this.orders.updateTrip(id, trip.seq, {
          receivedOn: input.receivedOn,
          receivedNote: input.note,
        });
        const row = await this.orders.update(id, {
          status: 'arrived',
          firstReceivedOn: order.firstReceivedOn ?? input.receivedOn,
        });
        await this.record(
          row,
          'lab_order.receive',
          { status: order.status },
          {
            number: number(row),
            status: row.status,
            trip: trip.seq,
            receivedOn: input.receivedOn,
            promisedOn: trip.promisedOn,
          },
        );
        done.push(row);
      }
      const results: LabOrder[] = [];
      for (const row of done) results.push(await this.presenter.detail(row));
      return results;
    });
  }

  /** The lab announced a delay (B3): the plan moves, the promise stays. */
  expected(id: string, input: ExpectedLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order, trips) => {
      assertCan('expected', order.status);
      const trip = trips.at(-1) as StoredTrip;
      if (input.expectedOn < trip.sentOn) {
        throw new LabDateOrderError('The expected date can’t be before sending', {
          sentOn: trip.sentOn,
        });
      }
      if (input.expectedOn === trip.expectedOn) return order;
      await this.orders.updateTrip(order.id, trip.seq, { expectedOn: input.expectedOn });
      await this.record(
        order,
        'lab_order.expected',
        { number: number(order), expectedOn: trip.expectedOn },
        { number: number(order), expectedOn: input.expectedOn, promisedOn: trip.promisedOn },
      );
      return order;
    });
  }

  /** Fitted, back to the lab, or a remake (B4, B6). */
  outcome(id: string, input: LabOutcome): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    const charge =
      input.choice === 'remake' &&
      input.borneBy === 'clinic' &&
      input.charge !== null &&
      toCents(input.charge) > 0n
        ? input.charge
        : null;
    if (charge !== null) this.context.requirePermission('lab:money_manage');
    return this.withOrder(id, async (order, trips) => {
      assertCan('outcome', order.status);
      const today = await this.calendar.today();
      const trip = trips.at(-1) as StoredTrip;
      const status = statusAfterOutcome(input.choice);
      if (input.choice === 'fitted') {
        const row = await this.orders.update(order.id, { status, doneOn: today });
        await this.record(
          row,
          'lab_order.done',
          { status: order.status },
          { number: number(row), status },
        );
        return row;
      }
      await this.orders.updateTrip(order.id, trip.seq, {
        outcome: input.choice,
        outcomeNote: input.note,
        outcomeOn: today,
        remakeReason: input.choice === 'remake' ? input.reason : null,
        remakeBorneBy: input.choice === 'remake' ? input.borneBy : null,
        remakeCharge: charge === null ? null : fromCents(toCents(charge)),
      });
      const row = await this.orders.update(order.id, { status, waitingSince: today });
      await this.record(
        row,
        input.choice === 'remake' ? 'lab_order.remake' : 'lab_order.send_back',
        { status: order.status },
        {
          number: number(row),
          status,
          outcome: input.choice,
          trip: trip.seq,
          ...(input.choice === 'remake' ? { reason: input.reason, borneBy: input.borneBy } : {}),
        },
      );
      if (charge !== null) {
        await this.record(row, 'lab_order.cost', null, {
          number: number(row),
          remakeCharge: fromCents(toCents(charge)),
          currency: row.currency,
        });
      }
      return row;
    });
  }

  hold(id: string, input: HoldLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order) => {
      assertCan('hold', order.status);
      const row = await this.orders.update(order.id, {
        status: 'on_hold',
        heldFrom: order.status,
        holdReason: input.reason,
      });
      await this.record(
        row,
        'lab_order.hold',
        { status: order.status },
        { number: number(row), status: row.status },
        input.reason,
      );
      return row;
    });
  }

  resume(id: string): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order) => {
      assertCan('resume', order.status);
      const status = order.heldFrom ?? 'to_send';
      const row = await this.orders.update(order.id, { status, heldFrom: null, holdReason: null });
      await this.record(
        row,
        'lab_order.resume',
        { status: order.status },
        { number: number(row), status },
      );
      return row;
    });
  }

  /** Free before sending; for work sent and never delivered the lab may still charge (D3). */
  cancel(id: string, input: CancelLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    if (input.charge !== null && toCents(input.charge) > 0n) {
      this.context.requirePermission('lab:money_manage');
    }
    return this.withOrder(id, async (order, trips) => {
      assertCan('cancel', order.status);
      const takesCharge = cancelTakesCharge({
        tripCount: trips.length,
        firstReceivedOn: order.firstReceivedOn,
      });
      const charge =
        takesCharge && input.charge !== null && toCents(input.charge) > 0n
          ? fromCents(toCents(input.charge))
          : null;
      const row = await this.orders.update(order.id, {
        status: 'cancelled',
        cancelledFrom: order.status === 'on_hold' ? (order.heldFrom ?? 'to_send') : order.status,
        heldFrom: null,
        holdReason: null,
        cancelReason: input.reason,
        cancelCharge: charge,
        cancelledOn: await this.calendar.today(),
      });
      await this.record(
        row,
        'lab_order.cancel',
        { status: order.status },
        { number: number(row), status: row.status, charged: charge !== null },
        input.reason,
      );
      if (charge !== null) {
        await this.record(row, 'lab_order.cost', null, {
          number: number(row),
          cancelCharge: charge,
          currency: row.currency,
        });
      }
      return row;
    });
  }

  /** One step back (ADR-0082), audited. */
  undo(id: string, input: UndoLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order, trips) => {
      const plan = requireUndoPlan(input.step, undoFacts(order, trips));
      const last = trips.at(-1);
      const patch: OrderPatch = { status: plan.status };
      if (plan.trip === 'delete' && last) await this.orders.deleteTrip(order.id, last.seq);
      if (plan.trip === 'unreceive' && last) {
        await this.orders.updateTrip(order.id, last.seq, { receivedOn: null, receivedNote: null });
        const stillReceived = trips
          .slice(0, -1)
          .flatMap((trip) => (trip.receivedOn ? [trip.receivedOn] : []));
        patch.firstReceivedOn = stillReceived.sort()[0] ?? null;
      }
      if (plan.trip === 'clear_outcome' && last) {
        await this.orders.updateTrip(order.id, last.seq, {
          outcome: null,
          outcomeNote: null,
          outcomeOn: null,
          remakeReason: null,
          remakeBorneBy: null,
          remakeCharge: null,
        });
      }
      if (input.step === 'done') patch.doneOn = null;
      if (input.step === 'cancel') {
        Object.assign(patch, {
          cancelledFrom: null,
          cancelReason: null,
          cancelCharge: null,
          cancelledOn: null,
        });
      }
      const row = await this.orders.update(order.id, patch);
      await this.record(
        row,
        'lab_order.undo',
        { status: order.status },
        {
          number: number(row),
          step: input.step,
          status: row.status,
        },
      );
      return row;
    });
  }

  /** Corrected sent and received dates (B2): never ahead, received on or after sent. */
  correctTrip(id: string, seq: number, input: CorrectLabTrip): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order, trips) => {
      assertCan('trip_dates', order.status);
      const trip = trips.find((candidate) => candidate.seq === seq);
      if (!trip) throw new LabOrderNotFoundError('No such trip', { seq });
      const patch: Partial<StoredTrip> = {};
      if (input.sentOn !== undefined && input.sentOn !== trip.sentOn) {
        await this.calendar.assertNotFuture(input.sentOn);
        Object.assign(patch, shiftTripDates(trip, input.sentOn));
      }
      if (input.receivedOn !== undefined && input.receivedOn !== trip.receivedOn) {
        if (trip.receivedOn === null) throw new LabDateOrderError('This trip has not arrived');
        await this.calendar.assertNotFuture(input.receivedOn);
        patch.receivedOn = input.receivedOn;
      }
      if (Object.keys(patch).length === 0) return order;
      const sentOn = patch.sentOn ?? trip.sentOn;
      const receivedOn = patch.receivedOn ?? trip.receivedOn;
      if (receivedOn !== null && receivedOn < sentOn) {
        throw new LabDateOrderError('The work can’t arrive before it was sent');
      }
      await this.orders.updateTrip(order.id, seq, patch);
      const received = trips
        .map((candidate) => (candidate.seq === seq ? receivedOn : candidate.receivedOn))
        .filter((date): date is string => date !== null)
        .sort();
      const row = await this.orders.update(order.id, { firstReceivedOn: received[0] ?? null });
      await this.record(
        row,
        'lab_order.trip_dates',
        { number: number(row), trip: seq, sentOn: trip.sentOn, receivedOn: trip.receivedOn },
        { number: number(row), trip: seq, sentOn, receivedOn },
      );
      return row;
    });
  }

  /** The appointment the work is needed for, set, changed or removed by a person (B5). */
  link(id: string, input: LinkLabOrder): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order) => {
      assertCan('link', order.status);
      if (input.appointmentId === order.appointmentId) return order;
      if (input.appointmentId !== null)
        await this.assertAppointment(input.appointmentId, order.patientId);
      return this.relink(order, input.appointmentId, 'user');
    });
  }

  attachments(id: string, input: LabOrderAttachments): Promise<LabOrder> {
    this.context.requirePermission('lab:manage');
    return this.withOrder(id, async (order) => {
      if (!canDo('edit', order.status)) throw new LabOrderClosedError('This order is closed');
      await this.assertFiles(input.fileIds, order.patientId);
      const before = (await this.orders.files([order.id])).map((link) => link.fileId);
      if (sameSet(before, input.fileIds)) return order;
      await this.orders.replaceFiles(order.id, input.fileIds);
      await this.record(
        order,
        'lab_order.attachments',
        { number: number(order), files: before.length },
        { number: number(order), files: input.fileIds.length },
      );
      return order;
    });
  }

  // --- Reactions, in the publisher's transaction (ADR-0084) ---

  /** A booking links every open order of the patient that has no appointment. */
  async onAppointmentBooked(appointmentId: string, patientId: string): Promise<void> {
    const orders = await this.orders.unlinkedOpenOf(patientId);
    for (const order of orders) await this.relink(order, appointmentId, 'booked');
  }

  /** A reschedule carries the link to the new appointment. */
  async onAppointmentRescheduled(fromId: string, toId: string): Promise<void> {
    for (const order of await this.orders.linkedTo(fromId))
      await this.relink(order, toId, 'rescheduled');
  }

  /** Cancelled, no-show or completed: the order waits for the next booking. */
  async onAppointmentClosed(appointmentId: string, cause: 'cancelled' | 'no_show' | 'completed') {
    for (const order of await this.orders.linkedTo(appointmentId))
      await this.relink(order, null, cause);
  }

  async onPatientsMerged(droppedId: string, keptId: string): Promise<void> {
    await this.orders.repointPatient(droppedId, keptId);
  }

  /** Archiving a patient with open lab work is refused (Rules). */
  async onPatientArchived(patientId: string): Promise<void> {
    const count = await this.orders.countOpenOf(patientId);
    if (count > 0) {
      throw new PatientHasOpenLabOrdersError('This patient has open lab orders', {
        patientId,
        count,
      });
    }
  }

  // --- Helpers ---

  private async relink(
    order: StoredOrder,
    appointmentId: string | null,
    cause: LinkCause,
  ): Promise<StoredOrder> {
    const row = await this.orders.update(order.id, { appointmentId });
    const action =
      appointmentId === null
        ? 'lab_order.unlink'
        : order.appointmentId === null
          ? 'lab_order.link'
          : 'lab_order.relink';
    await this.record(
      row,
      action,
      { number: number(row), appointmentId: order.appointmentId },
      { number: number(row), appointmentId, by: cause === 'user' ? 'user' : 'system', cause },
    );
    return row;
  }

  /** Locks the order and its trips, runs `work`, and answers with the order as it now is. */
  private withOrder(
    id: string,
    work: (order: StoredOrder, trips: StoredTrip[]) => Promise<StoredOrder>,
  ): Promise<LabOrder> {
    return this.tenantDb.run(async () => {
      const [order] = await this.orders.lock([id]);
      if (!order) throw new LabOrderNotFoundError('No such lab order', { id });
      const trips = await this.orders.trips([id]);
      await work(order, trips);
      const fresh = await this.orders.byId(id);
      return this.presenter.detail(fresh as StoredOrder);
    });
  }

  private record(
    order: StoredOrder,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason?: string,
  ): Promise<void> {
    return this.audit.about(
      { patientId: order.patientId, visitId: order.visitId ?? undefined },
      () =>
        this.audit.record({
          action,
          resourceType: 'lab_order',
          resourceId: order.id,
          before: before ?? undefined,
          after,
          reason,
        }),
    );
  }

  private async buildItems(
    lab: StoredLab,
    inputs: readonly LabOrderItemInput[],
    keepInactive = false,
  ): Promise<NewItem[]> {
    const serviceIds = inputs.flatMap((item) => (item.serviceId ? [item.serviceId] : []));
    const services = new Map(
      (await this.labs.servicesByIds(serviceIds)).map((row) => [row.id, row] as const),
    );
    return inputs.map((item) => {
      if (item.serviceId === null) {
        return {
          serviceId: null,
          description: item.description ?? '',
          unitPrice: null,
          turnaroundDays: null,
          quantity: item.quantity,
          shade: item.shade,
          target: item.target,
          teeth: teethFor(item.target, item.teeth),
        };
      }
      const service = services.get(item.serviceId);
      if (!service || service.labId !== lab.id) {
        throw new LabOrderReferenceError('This service is not on the lab’s price list', {
          serviceId: item.serviceId,
        });
      }
      if (!service.active && !keepInactive) {
        throw new LabServiceInactiveError('This service is no longer offered', {
          serviceId: item.serviceId,
        });
      }
      return {
        serviceId: service.id,
        description: service.name,
        unitPrice: service.price,
        turnaroundDays: service.turnaroundDays,
        quantity: item.quantity,
        shade: item.shade,
        target: item.target,
        teeth: teethFor(item.target, item.teeth),
      };
    });
  }

  private async requireActiveLab(id: string): Promise<StoredLab> {
    const lab = await this.labs.byId(id);
    if (!lab) throw new LabNotFoundError('No such lab', { id });
    if (!lab.active) throw new LabInactiveError('This lab is inactive', { id });
    return lab;
  }

  private async assertDentist(dentistId: string): Promise<void> {
    const practitioners = await this.users.listPractitioners();
    if (!practitioners.some((item) => item.id === dentistId)) {
      throw new LabOrderReferenceError('No such dentist', { dentistId });
    }
  }

  private async assertBranch(branchId: string): Promise<void> {
    if ((await this.tenancy.activeBranches([branchId])).length === 0) {
      throw new LabOrderReferenceError('No such branch', { branchId });
    }
  }

  private async assertVisit(visitId: string, patientId: string): Promise<void> {
    const [visit] = await this.visits.refsFor([visitId]);
    if (!visit || visit.patientId !== patientId) {
      throw new LabOrderReferenceError('This visit is not the patient’s', { visitId });
    }
  }

  private async assertPlans(planIds: readonly string[], patientId: string): Promise<void> {
    if (planIds.length === 0) return;
    const owners = await this.visits.planOwners(planIds);
    if (planIds.some((planId) => owners.get(planId)?.patientId !== patientId)) {
      throw new LabOrderReferenceError('A planned item is not the patient’s');
    }
  }

  private async assertFiles(fileIds: readonly string[], patientId: string): Promise<void> {
    if (fileIds.length === 0) return;
    const refs = await this.files.refs(fileIds);
    if (
      refs.length !== fileIds.length ||
      refs.some((file) => file.patientId !== patientId || file.archived)
    ) {
      throw new LabOrderReferenceError('A file is not the patient’s');
    }
  }

  private async assertAppointment(appointmentId: string, patientId: string): Promise<void> {
    const [ref] = await this.appointments.refs([appointmentId]);
    if (!ref || ref.patientId !== patientId || !isUpcoming(ref, await this.calendar.today())) {
      throw new LabAppointmentInvalidError('Choose an upcoming appointment of this patient', {
        appointmentId,
      });
    }
  }
}

/** Σ price × quantity of the priced items (B1). */
function estimate(items: readonly NewItem[]): string {
  return fromCents(
    items.reduce(
      (sum, item) => sum + (item.unitPrice ? toCents(item.unitPrice) * BigInt(item.quantity) : 0n),
      0n,
    ),
  );
}

const shape = (
  item: Pick<NewItem, 'serviceId' | 'description' | 'quantity' | 'shade' | 'target' | 'teeth'>,
) => [
  item.serviceId ?? null,
  item.description,
  item.quantity,
  item.shade ?? null,
  item.target,
  [...(item.teeth ?? [])],
];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
