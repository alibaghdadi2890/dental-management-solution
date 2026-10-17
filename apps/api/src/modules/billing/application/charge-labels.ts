import {
  type AllocationLine,
  fromCents,
  type LedgerEntryKind,
  type VisitNumber,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { VisitFactsService } from '../../clinical';

interface ChargeLine {
  targetId: string;
  patientId: string;
  kind: LedgerEntryKind;
  visitId: string | null;
  date: string;
  amount: bigint;
  /** ADR-0051: the money came from a payment held for the plan. */
  fromAdvance: boolean;
}

/**
 * Turns allocation lines into the contract's `AllocationLine`s, with each visit's display number
 * and type (`VisitFactsService.numbersFor`, one query). Visit targets are dated by their visit's
 * local date.
 */
@Injectable()
export class ChargeLabels {
  constructor(private readonly visits: VisitFactsService) {}

  /** Each visit's number, date and type, by id. */
  async visitsOf(visitIds: readonly (string | null)[]): Promise<Map<string, VisitNumber>> {
    const ids = visitIds.filter((id): id is string => id !== null);
    if (ids.length === 0) return new Map();
    return new Map((await this.visits.numbersFor(ids)).map((visit) => [visit.visitId, visit]));
  }

  async visitNumbers(visitIds: readonly (string | null)[]): Promise<Map<string, number>> {
    const visits = await this.visitsOf(visitIds);
    return new Map([...visits].map(([id, visit]) => [id, visit.displayNumber]));
  }

  async label(lines: readonly ChargeLine[]): Promise<AllocationLine[]> {
    const visits = await this.visitsOf(lines.map((line) => line.visitId));
    const visitOf = (line: ChargeLine) =>
      line.visitId === null ? undefined : visits.get(line.visitId);
    return lines.map((line) => ({
      entryId: line.targetId,
      patientId: line.patientId,
      kind: line.kind,
      visitId: line.visitId,
      visitNumber: visitOf(line)?.displayNumber ?? null,
      visitType: visitOf(line)?.type ?? null,
      date: line.date,
      amount: fromCents(line.amount),
      fromAdvance: line.fromAdvance,
    }));
  }
}
