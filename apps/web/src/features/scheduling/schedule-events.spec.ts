import type { Appointment } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { arrangeEvents, type CalendarEvent, layOutDay, layOutLanes } from './schedule-events';
import { instantOf } from './schedule-time';

const BEIRUT = 'Asia/Beirut';
const DAY = '2026-10-29';
const NEXT_DAY = '2026-10-30';

const event = (
  id: string,
  from: string,
  to: string,
  extra: { date?: string; dentistId?: string; status?: string; pending?: boolean } = {},
): CalendarEvent => ({
  id,
  title: id,
  start: instantOf(extra.date ?? DAY, from, BEIRUT),
  end: instantOf(extra.date ?? DAY, to, BEIRUT),
  dentistId: extra.dentistId ?? 'd1',
  appointment: {
    status: extra.status ?? 'confirmed',
    patient: { fullName: `Patient${id} Family` },
  } as unknown as Appointment,
  ...(extra.pending ? { pending: true } : {}),
});

describe('layOutLanes', () => {
  it('gives overlapping cards their shared width, and adjacent ones none', () => {
    const laid = layOutLanes([
      event('a', '09:00', '10:00'),
      event('b', '09:30', '10:30'),
      event('c', '10:30', '11:00'),
    ]);
    expect(laid.get('a')?.lanes).toBe(2);
    expect(laid.get('b')?.lanes).toBe(2);
    expect(laid.get('c')?.lanes).toBe(1);
  });

  it('reuses a lane once a card has ended', () => {
    const laid = layOutLanes([
      event('a', '09:00', '11:00'),
      event('b', '09:00', '09:30'),
      event('c', '09:30', '10:00'),
    ]);
    expect(laid.get('c')?.lanes).toBe(2);
    expect(laid.get('c')?.lane).toBe(1);
  });
});

describe('layOutDay', () => {
  const strip = (id: string, from: string, to: string) => ({
    ...event(id, from, to, { status: 'cancelled' }),
    strip: true,
  });

  it('puts strips outside the lanes, and narrows only the runs they overlap', () => {
    const boxes = layOutDay([
      event('a', '09:00', '10:00'),
      event('b', '09:30', '10:30'),
      event('c', '11:00', '11:30'),
      strip('x', '10:15', '10:45'),
      strip('y', '10:30', '11:00'),
    ]);
    expect(boxes.get('a')).toEqual({ strip: false, lane: 0, lanes: 2, besideStrip: true });
    expect(boxes.get('b')).toEqual({ strip: false, lane: 1, lanes: 2, besideStrip: true });
    expect(boxes.get('c')).toEqual({ strip: false, lane: 0, lanes: 1, besideStrip: false });
    expect(boxes.get('x')).toEqual({ strip: true, lane: 0, lanes: 2, besideStrip: false });
    expect(boxes.get('y')).toEqual({ strip: true, lane: 1, lanes: 2, besideStrip: false });
  });
});

describe('arrangeEvents', () => {
  const crowd = [
    event('a', '09:00', '10:00'),
    event('b', '09:00', '10:00', { dentistId: 'd2', status: 'in_room' }),
    event('c', '09:15', '10:15', { dentistId: 'd3', status: 'checked_in' }),
  ];

  it('collapses three overlapping cards in a week column into one', () => {
    const [card, ...others] = arrangeEvents(crowd, 'week', BEIRUT);
    expect(others).toEqual([]);
    expect(card?.cluster).toEqual({
      date: DAY,
      count: 3,
      inClinic: 2,
      firstNames: ['Patienta', 'Patientb', 'Patientc'],
    });
    expect(card?.start).toEqual(crowd[0]?.start);
    expect(card?.end).toEqual(crowd[2]?.end);
  });

  it('keeps two overlapping cards side by side', () => {
    const arranged = arrangeEvents(crowd.slice(0, 2), 'week', BEIRUT);
    expect(arranged.map((item) => item.lanes)).toEqual([2, 2]);
    expect(arranged.some((item) => item.cluster)).toBe(false);
  });

  it('never mixes days, and leaves others of the day alone', () => {
    const arranged = arrangeEvents(
      [...crowd, event('d', '14:00', '14:30'), event('e', '09:00', '10:00', { date: NEXT_DAY })],
      'week',
      BEIRUT,
    );
    expect(arranged.filter((item) => item.cluster)).toHaveLength(1);
    expect(arranged.filter((item) => !item.cluster).map((item) => item.id)).toEqual(['d', 'e']);
  });

  it('never collapses in the day view: each dentist has their own column', () => {
    const arranged = arrangeEvents(crowd, 'day', BEIRUT);
    expect(arranged.map((item) => item.lanes)).toEqual([1, 1, 1]);
    expect(arranged.some((item) => item.cluster)).toBe(false);
  });

  it('leaves a card that is being moved out of a cluster', () => {
    const arranged = arrangeEvents(
      [...crowd, event('m', '09:30', '10:00', { pending: true })],
      'week',
      BEIRUT,
    );
    expect(arranged.find((item) => item.id === 'm')?.cluster).toBeUndefined();
  });

  it('draws a cancelled card as a strip: no lane taken, never in a cluster', () => {
    const cancelled = event('x', '09:00', '10:00', { status: 'cancelled' });
    const week = arrangeEvents([...crowd.slice(0, 2), cancelled], 'week', BEIRUT);
    expect(week.some((item) => item.cluster)).toBe(false);
    expect(week.filter((item) => !item.strip).map((item) => item.lanes)).toEqual([2, 2]);
    expect(week.find((item) => item.id === 'x')).toMatchObject({ strip: true, lanes: 1 });
    const day = arrangeEvents([crowd[0] as CalendarEvent, cancelled], 'day', BEIRUT);
    expect(day.find((item) => item.id === 'a')?.lanes).toBe(1);
  });
});
