import type { AgreementComponent, AgreementPreset } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { AgreementRecord } from '../domain/agreements';
import { AgreementOverlapError } from '../domain/compensation-errors';
import { compensationAgreements } from './schema';

const EXCLUSION_VIOLATION = '23P01';
const OVERLAP_CONSTRAINT = 'compensation_agreements_no_overlap';

/** An agreement as stored: the domain's view plus what the screens show. */
export interface StoredAgreement extends AgreementRecord {
  note: string | null;
  createdAt: Date;
  endReason: string | null;
  supersededAt: Date | null;
  supersedeReason: string | null;
}

export interface NewAgreement {
  profileId: string;
  preset: AgreementPreset;
  components: AgreementComponent[];
  effectiveFrom: string;
  effectiveTo: string | null;
  statementVisibleToDentist: boolean;
  note: string | null;
  createdBy: string;
}

type Row = typeof compensationAgreements.$inferSelect;

function toStored(row: Row): StoredAgreement {
  return {
    id: row.id,
    profileId: row.staffProfileId,
    preset: row.preset,
    components: row.components,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    statementVisibleToDentist: row.statementVisibleToDentist,
    superseded: row.supersededAt !== null,
    note: row.note,
    createdAt: row.createdAt,
    endReason: row.endReason,
    supersededAt: row.supersededAt,
    supersedeReason: row.supersedeReason,
  };
}

/** True when `error` (or the pg error Drizzle wraps) is the agreements' overlap exclusion. */
function isOverlap(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === EXCLUSION_VIOLATION && candidate.constraint === OVERLAP_CONSTRAINT) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** The tenant's compensation agreements (RLS through `TenantDb`); append-only (ADR-0058). */
@Injectable()
export class AgreementsRepository {
  constructor(private readonly db: TenantDb) {}

  /** The agreements of `profileIds` (every dentist when omitted), oldest first. */
  list(profileIds?: readonly string[]): Promise<StoredAgreement[]> {
    if (profileIds?.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(compensationAgreements)
          .where(
            profileIds === undefined
              ? undefined
              : inArray(compensationAgreements.staffProfileId, [...profileIds]),
          )
          .orderBy(asc(compensationAgreements.effectiveFrom), asc(compensationAgreements.createdAt))
      ).map(toStored),
    );
  }

  find(profileId: string, id: string): Promise<StoredAgreement | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationAgreements)
        .where(
          and(
            eq(compensationAgreements.id, id),
            eq(compensationAgreements.staffProfileId, profileId),
          ),
        );
      return row ? toStored(row) : undefined;
    });
  }

  /** Overlapping a live agreement of the same dentist → 422 `compensation.overlap`. */
  async insert(agreement: NewAgreement): Promise<StoredAgreement> {
    try {
      return await this.db.run(async (tx) => {
        const [row] = await tx
          .insert(compensationAgreements)
          .values({ ...agreement, staffProfileId: agreement.profileId })
          .returning();
        if (!row) throw new Error('compensation_agreements insert returned no row');
        return toStored(row);
      });
    } catch (error) {
      if (isOverlap(error)) {
        throw new AgreementOverlapError('Another agreement is in force on those dates', {
          effectiveFrom: agreement.effectiveFrom,
        });
      }
      throw error;
    }
  }

  async end(
    id: string,
    end: { effectiveTo: string; at: Date; by: string; reason: string | null },
  ): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(compensationAgreements)
        .set({
          effectiveTo: end.effectiveTo,
          endedAt: end.at,
          endedBy: end.by,
          endReason: end.reason,
        })
        .where(eq(compensationAgreements.id, id)),
    );
  }

  async supersede(
    id: string,
    supersede: { at: Date; by: string; reason: string | null },
  ): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(compensationAgreements)
        .set({
          supersededAt: supersede.at,
          supersededBy: supersede.by,
          supersedeReason: supersede.reason,
        })
        .where(eq(compensationAgreements.id, id)),
    );
  }
}
