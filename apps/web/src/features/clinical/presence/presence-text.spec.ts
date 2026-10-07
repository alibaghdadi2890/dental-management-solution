import type { ToothPresenceRecord } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { latestPresence, presenceBanner, presenceEntry } from './presence-text';

const t = i18n.getFixedT('en', 'clinical');
const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const row = (patch: Partial<ToothPresenceRecord>): ToothPresenceRecord => ({
  id: id(1),
  toothCode: '36',
  presence: 'missing',
  occurredOn: null,
  reason: null,
  dentistId: id(2),
  dentistName: 'Dr. Haddad',
  visitId: null,
  visitNumber: null,
  serviceId: null,
  serviceCode: null,
  serviceName: null,
  recordedAt: '2026-06-03T09:00:00.000Z',
  ...patch,
});

describe('presenceBanner (H1, H3a): what the chart knows, in the words it was recorded with', () => {
  it('names the service and visit that caused it', () => {
    expect(
      presenceBanner(
        t,
        row({
          occurredOn: '2026-03-12',
          visitId: id(3),
          visitNumber: 45,
          serviceId: id(4),
          serviceCode: 'EXT-01',
          serviceName: 'Extraction',
        }),
        'en',
      ),
    ).toBe('Missing since 12 Mar 2026 · Extraction, visit V-000045');
    expect(
      presenceBanner(
        t,
        row({
          presence: 'implant',
          occurredOn: '2026-08-20',
          visitId: id(3),
          visitNumber: 71,
          serviceId: id(4),
          serviceCode: 'IMP',
          serviceName: 'Implant placement',
        }),
        'en',
      ),
    ).toBe('Implant since 20 Aug 2026 · Implant placement, visit V-000071');
  });

  it('never invents a date for "before first visit"', () => {
    expect(presenceBanner(t, row({ dentistName: '' }), 'en')).toBe('Missing · before first visit');
    expect(presenceBanner(t, row({ presence: 'implant', dentistName: '' }), 'en')).toBe(
      'Implant · before first visit',
    );
  });

  it('gives the date, the reason and who recorded a presence set by hand', () => {
    expect(presenceBanner(t, row({ occurredOn: '2026-06-03', reason: 'accident' }), 'en')).toBe(
      'Missing since 3 Jun 2026 · accident · recorded by Dr. Haddad',
    );
    expect(
      presenceBanner(
        t,
        row({ presence: 'not_erupted', occurredOn: '2026-06-10', visitId: id(3), visitNumber: 7 }),
        'en',
      ),
    ).toBe('Not erupted since 10 Jun 2026 · visit V-000007 · recorded by Dr. Haddad');
  });
});

describe('presenceEntry: a line of the tooth history', () => {
  it('reads "Marked missing — Extraction (EXT-01), visit V-000045"', () => {
    expect(
      presenceEntry(
        t,
        row({
          occurredOn: '2026-03-12',
          visitId: id(3),
          visitNumber: 45,
          serviceId: id(4),
          serviceCode: 'EXT-01',
          serviceName: 'Extraction',
        }),
      ),
    ).toEqual({ title: 'Marked missing', detail: 'Extraction (EXT-01), visit V-000045' });
  });

  it('reads a row set by hand with where it came from and who recorded it', () => {
    expect(presenceEntry(t, row({ presence: 'implant' }))).toEqual({
      title: 'Marked implant',
      detail: 'before first visit · recorded by Dr. Haddad',
    });
    expect(presenceEntry(t, row({ presence: 'present', occurredOn: '2026-06-10' }))).toEqual({
      title: 'Marked present',
      detail: 'recorded by Dr. Haddad',
    });
  });
});

describe('latestPresence', () => {
  it('is the last row recorded for the tooth', () => {
    const chart = {
      presence: [
        row({ id: id(5), toothCode: '46', presence: 'missing' }),
        row({ id: id(6), toothCode: '36' }),
        row({ id: id(7), toothCode: '46', presence: 'implant' }),
      ],
    };
    expect(latestPresence(chart, '46')?.id).toBe(id(7));
    expect(latestPresence(chart, '11')).toBeUndefined();
  });
});
