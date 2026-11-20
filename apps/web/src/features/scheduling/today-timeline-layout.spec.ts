import { describe, expect, it } from 'vitest';
import {
  type TimelineItem,
  timelineLayout,
  waitingTone,
  zoneOffsetMs,
} from './today-timeline-layout';

const BEIRUT = 'Asia/Beirut'; // UTC+2 in November
const KOLKATA = 'Asia/Kolkata'; // UTC+5:30

const at = (iso: string) => Date.parse(iso);
const item = (
  id: string,
  dentistName: string,
  startsAt: string,
  endsAt: string,
  status: TimelineItem['status'] = 'confirmed',
): TimelineItem => ({ id, dentistName, startsAt, endsAt, status });

describe('timelineLayout', () => {
  const day = [
    item('a', 'Dr Karam', '2026-11-20T07:15:00Z', '2026-11-20T07:45:00Z'), // 09:15–09:45
    item('b', 'Dr Nassar', '2026-11-20T09:00:00Z', '2026-11-20T10:00:00Z'), // 11:00–12:00
    item('c', 'Dr Karam', '2026-11-20T12:30:00Z', '2026-11-20T13:10:00Z'), // 14:30–15:10
  ];

  it('spans the whole local hours around the day, one lane per dentist in first-seen order', () => {
    const layout = timelineLayout(day, at('2026-11-20T08:00:00Z'), BEIRUT);
    expect(layout?.start).toBe(at('2026-11-20T07:00:00Z')); // 09:00 Beirut
    expect(layout?.end).toBe(at('2026-11-20T14:00:00Z')); // 16:00 Beirut
    expect(layout?.ticks).toHaveLength(8);
    expect(layout?.lanes.map((lane) => lane.dentistName)).toEqual(['Dr Karam', 'Dr Nassar']);
    const [first] = layout?.lanes[0]?.blocks ?? [];
    expect(first?.left).toBeCloseTo(15 / 420);
    expect(first?.width).toBeCloseTo(30 / 420);
    expect(layout?.now).toBeCloseTo(60 / 420);
  });

  it('takes in now when it is near the day, and leaves the line off when it is far', () => {
    const early = timelineLayout(day, at('2026-11-20T06:20:00Z'), BEIRUT); // 08:20
    expect(early?.start).toBe(at('2026-11-20T06:00:00Z'));
    expect(early?.now).toBeCloseTo(20 / 480);

    const night = timelineLayout(day, at('2026-11-20T20:00:00Z'), BEIRUT); // 22:00
    expect(night?.end).toBe(at('2026-11-20T14:00:00Z'));
    expect(night?.now).toBeNull();
  });

  it('floors to the local hour in a half-hour time zone', () => {
    const layout = timelineLayout(
      [item('a', 'Dr K', '2026-11-20T04:00:00Z', '2026-11-20T04:30:00Z')], // 09:30–10:00 IST
      at('2026-11-20T00:00:00Z'),
      KOLKATA,
    );
    expect(layout?.start).toBe(at('2026-11-20T03:30:00Z')); // 09:00 IST
    expect(layout?.end).toBe(at('2026-11-20T04:30:00Z')); // 10:00 IST
  });

  it('stacks overlapping appointments, those holding their time on the first track', () => {
    const layout = timelineLayout(
      [
        item('x', 'Dr K', '2026-11-20T07:00:00Z', '2026-11-20T08:00:00Z', 'cancelled'),
        item('y', 'Dr K', '2026-11-20T07:30:00Z', '2026-11-20T08:00:00Z'),
        item('z', 'Dr K', '2026-11-20T08:00:00Z', '2026-11-20T08:30:00Z'),
      ],
      at('2026-11-20T07:00:00Z'),
      BEIRUT,
    );
    const lane = layout?.lanes[0];
    expect(lane?.tracks).toBe(2);
    const track = (id: string) => lane?.blocks.find((block) => block.item.id === id)?.track;
    expect([track('y'), track('z'), track('x')]).toEqual([0, 0, 1]);
  });

  it('is null without appointments', () => {
    expect(timelineLayout([], Date.now(), BEIRUT)).toBeNull();
  });
});

describe('zoneOffsetMs', () => {
  it('reads the wall clock ahead of UTC', () => {
    expect(zoneOffsetMs(at('2026-11-20T12:00:00Z'), KOLKATA)).toBe(5.5 * 3_600_000);
  });
});

describe('waitingTone', () => {
  it('warns from 10 minutes and alarms from 20', () => {
    expect([9, 10, 19, 20].map(waitingTone)).toEqual(['normal', 'warning', 'warning', 'danger']);
  });
});
