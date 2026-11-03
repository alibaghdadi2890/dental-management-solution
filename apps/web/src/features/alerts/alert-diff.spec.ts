import type { AlertInRoom, AlertTray, AlertWaiting } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { diffTray, unreadKeys } from './alert-diff';

const ME = '00000000-0000-4000-8000-000000000001';
const DESK = '00000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const waiting = (n: number): AlertWaiting => ({
  appointmentId: id(n),
  patientId: id(100 + n),
  patientName: `Patient ${String(n)}`,
  dentistId: id(200),
  dentistName: 'Dr. Reyes',
  roomName: 'Room 1',
  startsAt: '2026-11-03T10:00:00.000Z',
  checkedInAt: '2026-11-03T09:55:00.000Z',
});

const inRoom = (n: number, startedBy = DESK): AlertInRoom => ({
  visitId: id(n),
  patientId: id(100 + n),
  patientName: `Patient ${String(n)}`,
  dentistId: id(200),
  dentistName: 'Dr. Reyes',
  roomName: 'Room 1',
  status: 'in_progress',
  startedAt: '2026-11-03T10:01:00.000Z',
  pausedAt: null,
  pausedSeconds: 0,
  startedBy,
  startedByName: startedBy === DESK ? 'Jamie' : 'Me',
});

const tray = (parts: Partial<AlertTray>): AlertTray => ({
  waiting: [],
  inRoom: [],
  follows: [],
  serverNow: '2026-11-03T10:02:00.000Z',
  ...parts,
});

describe('diffTray', () => {
  it('only records what is there on the first load in this browser', () => {
    const result = diffTray(null, tray({ waiting: [waiting(1)], inRoom: [inRoom(2)] }), ME);
    expect(result.alerts).toEqual([]);
    expect([...result.seen].sort()).toEqual([`arrived:${id(1)}`, `started:${id(2)}`]);
  });

  it('alerts for what is new, an arrival and a start by the front desk', () => {
    const seen = new Set([`arrived:${id(1)}`]);
    const result = diffTray(
      seen,
      tray({ waiting: [waiting(1), waiting(3)], inRoom: [inRoom(2)] }),
      ME,
    );
    expect(result.alerts.map((alert) => alert.key)).toEqual([
      `started:${id(2)}`,
      `arrived:${id(3)}`,
    ]);
  });

  it("never alerts for the caller's own start, and forgets what left", () => {
    const seen = new Set([`arrived:${id(1)}`, `started:${id(9)}`]);
    const result = diffTray(seen, tray({ inRoom: [inRoom(4, ME)] }), ME);
    expect(result.alerts).toEqual([]);
    expect([...result.seen]).toEqual([`started:${id(4)}`]);
    // Checked in again after an undo: it alerts again.
    expect(diffTray(result.seen, tray({ waiting: [waiting(1)] }), ME).alerts).toHaveLength(1);
  });
});

describe('unreadKeys', () => {
  it('is what the list did not show when last opened, own starts aside', () => {
    const opened = new Set([`arrived:${id(1)}`]);
    expect(
      unreadKeys(tray({ waiting: [waiting(1), waiting(3)], inRoom: [inRoom(4, ME)] }), opened, ME),
    ).toEqual([`arrived:${id(3)}`]);
  });
});
