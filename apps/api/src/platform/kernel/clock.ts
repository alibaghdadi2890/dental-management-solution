/** Source of "now" for rules that depend on time (lockout, idle timeout). Pure: domain may use it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock tests move by hand. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advance({ minutes = 0, seconds = 0 }: { minutes?: number; seconds?: number }): void {
    this.current = new Date(this.current.getTime() + (minutes * 60 + seconds) * 1_000);
  }
}
