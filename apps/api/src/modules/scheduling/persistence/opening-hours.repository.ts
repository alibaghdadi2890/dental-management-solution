import { DEFAULT_FOLLOW_UP_WINDOW_DAYS, type OpeningDay, WEEKDAYS } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { branchOpeningHours, schedulingSettings } from './schema';

/** Monday to Saturday, 08:00 to 18:00 (ADR-0068). */
export const DEFAULT_OPENING_HOURS: readonly OpeningDay[] = WEEKDAYS.map((weekday) => ({
  weekday,
  isOpen: weekday !== 0,
  from: '08:00',
  to: '18:00',
}));

const clock = (time: string) => time.slice(0, 5);

@Injectable()
export class OpeningHoursRepository {
  constructor(private readonly db: TenantDb) {}

  /** The seven days; a branch that has none yet reads as the default. */
  async forBranch(branchId: string): Promise<OpeningDay[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(branchOpeningHours)
        .where(eq(branchOpeningHours.branchId, branchId))
        .orderBy(asc(branchOpeningHours.weekday)),
    );
    if (rows.length === 0) return [...DEFAULT_OPENING_HOURS];
    return rows.map((row) => ({
      weekday: row.weekday,
      isOpen: row.isOpen,
      from: clock(row.fromTime),
      to: clock(row.toTime),
    }));
  }

  async seed(branchId: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(branchOpeningHours)
        .values(
          DEFAULT_OPENING_HOURS.map((day) => ({
            branchId,
            weekday: day.weekday,
            isOpen: day.isOpen,
            fromTime: day.from,
            toTime: day.to,
          })),
        )
        .onConflictDoNothing(),
    );
  }

  async save(branchId: string, days: readonly OpeningDay[]): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(branchOpeningHours)
        .values(
          days.map((day) => ({
            branchId,
            weekday: day.weekday,
            isOpen: day.isOpen,
            fromTime: day.from,
            toTime: day.to,
          })),
        )
        .onConflictDoUpdate({
          target: [branchOpeningHours.branchId, branchOpeningHours.weekday],
          set: {
            isOpen: sql`excluded.is_open`,
            fromTime: sql`excluded.from_time`,
            toTime: sql`excluded.to_time`,
            updatedAt: sql`now()`,
          },
        }),
    );
  }

  async windowDays(): Promise<number> {
    const [row] = await this.db.run((tx) => tx.select().from(schedulingSettings));
    return row?.followUpWindowDays ?? DEFAULT_FOLLOW_UP_WINDOW_DAYS;
  }

  async saveWindowDays(days: number): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(schedulingSettings)
        .values({ followUpWindowDays: days })
        .onConflictDoUpdate({
          target: schedulingSettings.tenantId,
          set: { followUpWindowDays: days, updatedAt: sql`now()` },
        }),
    );
  }
}
