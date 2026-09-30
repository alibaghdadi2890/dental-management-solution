import { describe, expect, it } from 'vitest';
import { elapsedSeconds, resumePausedSeconds } from './visit-timer';

const at = (time: string) => new Date(`2026-09-30T${time}Z`);

describe('elapsedSeconds', () => {
  it('counts from the start to now while running', () => {
    const visit = {
      startedAt: at('09:00:00'),
      pausedAt: null,
      pausedSeconds: 0,
      completedAt: null,
    };
    expect(elapsedSeconds(visit, at('09:12:30'))).toBe(750);
  });

  it('leaves out earlier pauses while running', () => {
    const visit = {
      startedAt: at('09:00:00'),
      pausedAt: null,
      pausedSeconds: 120,
      completedAt: null,
    };
    expect(elapsedSeconds(visit, at('09:12:30'))).toBe(630);
  });

  it('is frozen at pausedAt while paused', () => {
    const visit = {
      startedAt: at('09:00:00'),
      pausedAt: at('09:10:00'),
      pausedSeconds: 60,
      completedAt: null,
    };
    expect(elapsedSeconds(visit, at('09:30:00'))).toBe(540);
    expect(elapsedSeconds(visit, at('11:00:00'))).toBe(540);
  });

  it('is frozen at completedAt once completed', () => {
    const visit = {
      startedAt: at('09:00:00'),
      pausedAt: null,
      pausedSeconds: 300,
      completedAt: at('09:45:00'),
    };
    expect(elapsedSeconds(visit, at('12:00:00'))).toBe(2400);
  });

  it('drops sub-second remainders and never goes negative', () => {
    const visit = {
      startedAt: at('09:00:00.000'),
      pausedAt: null,
      pausedSeconds: 0,
      completedAt: null,
    };
    expect(elapsedSeconds(visit, at('09:00:01.999'))).toBe(1);
    expect(elapsedSeconds(visit, at('08:59:59'))).toBe(0);
  });
});

describe('resumePausedSeconds', () => {
  it('adds the pause that is ending to the paused total', () => {
    const visit = { pausedAt: at('09:10:00'), pausedSeconds: 60 };
    expect(resumePausedSeconds(visit, at('09:15:30'))).toBe(390);
  });

  it('resuming makes the running timer pick up where the pause froze it', () => {
    const startedAt = at('09:00:00');
    const paused = { startedAt, pausedAt: at('09:10:00'), pausedSeconds: 0, completedAt: null };
    const frozen = elapsedSeconds(paused, at('09:20:00'));
    const resumed = {
      startedAt,
      pausedAt: null,
      pausedSeconds: resumePausedSeconds(paused, at('09:20:00')),
      completedAt: null,
    };
    expect(elapsedSeconds(resumed, at('09:20:00'))).toBe(frozen);
    expect(elapsedSeconds(resumed, at('09:21:00'))).toBe(frozen + 60);
  });

  it('adds nothing when the clock reads before pausedAt', () => {
    const visit = { pausedAt: at('09:10:00'), pausedSeconds: 60 };
    expect(resumePausedSeconds(visit, at('09:09:00'))).toBe(60);
  });
});
