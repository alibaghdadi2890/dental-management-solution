import {
  type ExportLanguage,
  formatLabOrderNumber,
  type LabOrder,
  type LabOrderExportQuery,
  type LabOrderListQuery,
  type LabOrderPage,
  type LabOrderSummary,
  type LabProposal,
  type LabReport,
  type LabReportQuery,
  type LabToday,
  OPEN_LAB_ORDER_STATUSES,
  parseLabOrderNumber,
  type PatientListQuery,
  type PatientPage,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import { PatientsService } from '../../patients';
import { AppointmentsService } from '../../scheduling';
import { TenancyService } from '../../tenancy';
import { UsersService } from '../../users';
import { nextOpenDay } from '../domain/lab-dates';
import { LabOrderNotFoundError } from '../domain/lab-errors';
import { reportFigures, type ReportOrder } from '../domain/lab-reports';
import { lane } from '../domain/today-lane';
import { LabsRepository } from '../persistence/labs.repository';
import {
  type OrderFilter,
  OrdersRepository,
  type StoredOrder,
} from '../persistence/orders.repository';
import { LAB_EXPORT_LABELS } from './export-labels';
import { LabCalendar } from './lab-calendar';
import type { CsvFile } from './labs.service';
import { isUpcoming, OrderPresenter, toAppointmentRef } from './order-presenter';
import { itemsText } from './presenter';

const OPEN = [...OPEN_LAB_ORDER_STATUSES];

/**
 * Everything that reads lab orders (Parts B, C and E): the clinic list and its export, the open
 * orders behind every label and the booking warning, one order, Today's lane, the appointment to
 * propose, the patients filter and the reports. All need `lab:read`; costs only with
 * `lab:money_read`. Lab orders belong to the patient record, so none is scoped by dentist (O9).
 */
@Injectable()
export class LabOrderReadsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly calendar: LabCalendar,
    private readonly presenter: OrderPresenter,
    private readonly orders: OrdersRepository,
    private readonly labs: LabsRepository,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly appointments: AppointmentsService,
    private readonly tenancy: TenancyService,
  ) {}

  list(query: LabOrderListQuery): Promise<LabOrderPage> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const rows = await this.orders.list(await this.filter(query), query.limit + 1, query.cursor);
      const page = rows.slice(0, query.limit);
      return {
        items: await this.presenter.summaries(page),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** Every open order: the labels everywhere and the booking warning (C1, B5). */
  open(): Promise<LabOrderSummary[]> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => this.presenter.summaries(await this.orders.open()));
  }

  get(id: string): Promise<LabOrder> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const row = await this.orders.byId(id);
      if (!row) throw new LabOrderNotFoundError('No such lab order', { id });
      return this.presenter.detail(row);
    });
  }

  /** Today's Lab work lane for a branch (C3): exceptions only, each once. */
  today(branchId: string): Promise<LabToday> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const batch = await this.presenter.batch(await this.orders.open({ branchId }));
      const next = nextOpenDay(batch.today, await this.appointments.openWeekdays(branchId));
      const facts = batch.summaries.map((summary) => {
        const appointment = summary.appointment
          ? batch.appointments.get(summary.appointment.id)
          : undefined;
        return {
          summary,
          status: summary.status,
          priority: summary.priority,
          expectedOn: summary.receivedOn === null ? summary.expectedOn : null,
          appointmentDate: isUpcoming(appointment, batch.today)
            ? (appointment?.localDate ?? null)
            : null,
          waitingSince: summary.waitingSince,
          receivedOn: summary.receivedOn,
          createdAt: summary.createdAt,
        };
      });
      return {
        date: batch.today,
        nextOpenDay: next,
        rows: lane(facts, batch.today, next).map((row) => ({
          reason: row.reason,
          order: row.order.summary,
        })),
      };
    });
  }

  /**
   * Needs attention now (feature 19): open orders late at the lab, and orders arrived with no
   * appointment ahead (their ids, the Lab screen opens them), of a branch and a dentist.
   */
  attention(filter: {
    branchId?: string | undefined;
    dentistId?: string | undefined;
  }): Promise<{ late: number; arrivedUnbooked: string[] }> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const batch = await this.presenter.batch(
        await this.orders.open({ branchId: filter.branchId, dentistId: filter.dentistId }),
      );
      let late = 0;
      const arrivedUnbooked: string[] = [];
      for (const summary of batch.summaries) {
        if (summary.label?.kind === 'late') late += 1;
        const appointment = summary.appointment
          ? batch.appointments.get(summary.appointment.id)
          : undefined;
        if (summary.status === 'arrived' && !isUpcoming(appointment, batch.today)) {
          arrivedUnbooked.push(summary.id);
        }
      }
      return { late, arrivedUnbooked };
    });
  }

  /** The appointment to propose at creation (B5): the next with that dentist, else the next. */
  proposal(patientId: string, dentistId: string | undefined): Promise<LabProposal> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const upcoming = await this.appointments.upcomingFor(patientId);
      const pick = upcoming.find((ref) => ref.dentistId === dentistId) ?? upcoming[0] ?? null;
      return {
        appointment: pick ? toAppointmentRef(pick) : null,
        upcoming: upcoming.map(toAppointmentRef),
      };
    });
  }

  /** `GET /labs/patients`: the patients list restricted to open lab work (D1). */
  patientsWithOpenOrders(query: PatientListQuery): Promise<PatientPage> {
    this.context.requirePermission('lab:read');
    if (query.view === 'owing' || query.view === 'notSeen' || query.sort === 'balance') {
      const message = 'This view is served by billing';
      throw new ValidationFailedError(message, [{ path: 'view', code: 'unsupported', message }]);
    }
    return this.tenantDb.run(async () =>
      this.patients.search(query, { idsIn: await this.orders.patientIdsWithOpen() }),
    );
  }

  async export(query: LabOrderExportQuery): Promise<CsvFile> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const rows = await this.orders.list(await this.filter(query), 100_000);
      const summaries = await this.presenter.summaries(rows);
      const lang: ExportLanguage = query.lang ?? (await this.tenancy.currentTenant()).locale;
      const labels = LAB_EXPORT_LABELS[lang];
      const money = this.context.hasPermission('lab:money_read');
      const columns = labels.orders;
      const header = csvRow([
        columns.number,
        columns.created,
        columns.patient,
        columns.dentist,
        columns.lab,
        columns.items,
        columns.status,
        columns.priority,
        columns.sent,
        columns.expected,
        columns.received,
        columns.appointment,
        ...(money ? [columns.cost] : []),
      ]);
      const body = summaries.map((order) =>
        csvRow(
          [
            formatLabOrderNumber(order.displayNumber),
            order.createdAt.slice(0, 10),
            order.patient.fullName,
            order.dentistName,
            order.labName,
            itemsText(order.items),
            labels.statuses[order.status],
            order.priority === 'urgent' ? labels.urgent : '',
            order.sentOn ?? '',
            order.expectedOn ?? '',
            order.receivedOn ?? '',
            order.appointment?.localDate ?? '',
            ...(money ? [order.cost ?? ''] : []),
          ],
          { numericColumns: money ? [12] : [] },
        ),
      );
      return {
        fileName: `lab-orders-${await this.calendar.today()}.csv`,
        body: UTF8_BOM + header + body.join(''),
      };
    });
  }

  /** Part E: per lab, dentist or service, and for the clinic, with the orders behind each figure. */
  reports(query: LabReportQuery): Promise<LabReport> {
    this.context.requirePermission('lab:read');
    return this.tenantDb.run(async () => {
      const money = this.context.hasPermission('lab:money_read');
      const rows = await this.orders.touchedBetween(query.from, query.to);
      const ids = rows.map((row) => row.id);
      const [trips, items] = await Promise.all([this.orders.trips(ids), this.orders.items(ids)]);
      const facts = new Map<string, ReportOrder>(
        rows.map((row) => [
          row.id,
          {
            id: row.id,
            cost: row.cost,
            firstReceivedOn: row.firstReceivedOn,
            doneOn: row.doneOn,
            cancelledOn: row.status === 'cancelled' ? row.cancelledOn : null,
            cancelCharge: row.status === 'cancelled' ? row.cancelCharge : null,
            trips: trips.filter((trip) => trip.orderId === row.id),
          },
        ]),
      );
      const groups = new Map<string, { name: string; orders: ReportOrder[] }>();
      const add = (key: string, name: string, order: StoredOrder) => {
        const group = groups.get(key) ?? { name, orders: [] };
        group.orders.push(facts.get(order.id) as ReportOrder);
        groups.set(key, group);
      };
      if (query.groupBy === 'lab') {
        const labs = new Map(
          (await this.labs.byIds([...new Set(rows.map((row) => row.labId))])).map((lab) => [
            lab.id,
            lab.name,
          ]),
        );
        for (const row of rows) add(row.labId, labs.get(row.labId) ?? '', row);
      } else if (query.groupBy === 'dentist') {
        const dentists = new Map(
          (
            await this.users.practitionersByProfileIds([
              ...new Set(rows.map((row) => row.dentistId)),
            ])
          ).map((dentist) => [dentist.id, dentist.displayName]),
        );
        for (const row of rows) add(row.dentistId, dentists.get(row.dentistId) ?? '', row);
      } else {
        for (const row of rows) {
          const own = items.filter((item) => item.orderId === row.id);
          const keys = new Map(
            own.map((item) => [item.serviceId ?? `free:${item.description}`, item.description]),
          );
          for (const [key, name] of keys) add(key, name, row);
        }
      }
      return {
        from: query.from,
        to: query.to,
        groupBy: query.groupBy,
        currency: await this.calendar.currency(),
        rows: [...groups.entries()]
          .map(([key, group]) => ({
            key,
            name: group.name,
            figures: reportFigures(group.orders, query.from, query.to, money),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        total: reportFigures([...facts.values()], query.from, query.to, money),
      };
    });
  }

  private async filter(query: Omit<LabOrderListQuery, 'cursor' | 'limit'>): Promise<OrderFilter> {
    const today = await this.calendar.today();
    let match: OrderFilter['match'];
    if (query.q !== undefined) {
      const typed = parseLabOrderNumber(query.q);
      const patientIds = this.context.hasPermission('patient:read')
        ? await this.patients.searchIds({ view: 'active', q: query.q, sort: 'name', dir: 'asc' })
        : [];
      match = { number: typed, patientIds };
    }
    return {
      statuses:
        query.status === undefined ? undefined : query.status === 'open' ? OPEN : [query.status],
      labId: query.labId,
      dentistId: query.dentistId,
      branchId: query.branchId,
      patientId: query.patientId,
      lateBefore: query.late ? today : undefined,
      createdFrom: query.from ? await this.calendar.startOf(query.from) : undefined,
      createdTo: query.to
        ? await this.calendar.startOf(
            new Date(Date.parse(`${query.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
          )
        : undefined,
      ids: query.ids,
      match,
    };
  }
}
