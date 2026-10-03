import { type AllocationLine, fromCents, type LedgerEntryKind } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { VisitsService } from '../../clinical';

interface ChargeLine {
  targetId: string;
  patientId: string;
  kind: LedgerEntryKind;
  visitId: string | null;
  date: string;
  amount: bigint;
}

/**
 * Turns allocation lines into the contract's `AllocationLine`s, with each visit's display number
 * (`VisitsService.numbersFor`, one query). Visit targets are dated by their visit's local date.
 */
@Injectable()
export class ChargeLabels {
  constructor(private readonly visits: VisitsService) {}

  async visitNumbers(visitIds: readonly (string | null)[]): Promise<Map<string, number>> {
    const ids = visitIds.filter((id): id is string => id !== null);
    if (ids.length === 0) return new Map();
    return new Map(
      (await this.visits.numbersFor(ids)).map((visit) => [visit.visitId, visit.displayNumber]),
    );
  }

  async label(lines: readonly ChargeLine[]): Promise<AllocationLine[]> {
    const numbers = await this.visitNumbers(lines.map((line) => line.visitId));
    return lines.map((line) => ({
      entryId: line.targetId,
      patientId: line.patientId,
      kind: line.kind,
      visitId: line.visitId,
      visitNumber: line.visitId === null ? null : (numbers.get(line.visitId) ?? null),
      date: line.date,
      amount: fromCents(line.amount),
    }));
  }
}
