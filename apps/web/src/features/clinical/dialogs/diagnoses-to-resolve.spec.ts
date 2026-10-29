import { describe, expect, it } from 'vitest';
import {
  chart,
  diagnosisRecord,
  OLDER_VISIT_ID,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace/workspace.test-utils';
import { diagnosesToResolve } from './diagnoses-to-resolve';

const listed = (...args: Parameters<typeof diagnosesToResolve>) =>
  diagnosesToResolve(...args).map(({ record, done }) => [
    record.name,
    done.map((item) => item.name),
  ]);

describe('diagnosesToResolve', () => {
  it('lists an active diagnosis on a tooth this visit treated, once, with what was done', () => {
    const caries = diagnosisRecord(10, 'Deep caries', '16');
    const crack = diagnosisRecord(12, 'Cracked tooth', '11', {
      recordedInVisitId: null,
      recordedAt: '2026-01-01T09:00:00.000Z',
    });
    const services = [
      visitService(20, 'Composite', '16'),
      visitService(22, 'Sealant', '16'),
      visitService(24, 'Bonding', '11'),
    ];
    expect(listed(visit({ services }), chart({ diagnoses: [caries, crack] }))).toEqual([
      ['Cracked tooth', ['Bonding']],
      ['Deep caries', ['Composite', 'Sealant']],
    ]);
  });

  it('lists the diagnosis a plan performed today was for', () => {
    const caries = diagnosisRecord(10, 'Deep caries', '16');
    const crown = treatmentPlan(30, 'Crown', '17', { diagnosisRecordId: caries.id });
    const performed = visitService(20, 'Crown', '17', { planId: crown.id });
    expect(
      listed(visit({ services: [performed] }), chart({ diagnoses: [caries], plans: [crown] })),
    ).toEqual([['Deep caries', ['Crown']]]);
  });

  it('lists the diagnosis of work completed today that an earlier visit charged (ADR-0064)', () => {
    const abscess = diagnosisRecord(10, 'Abscess', '36', { recordedInVisitId: OLDER_VISIT_ID });
    const caries = diagnosisRecord(12, 'Deep caries', '37', { recordedInVisitId: OLDER_VISIT_ID });
    const completed = {
      status: 'performed' as const,
      recordedInVisitId: OLDER_VISIT_ID,
      performedInVisitId: VISIT_ID,
      chargedIn: { visitId: OLDER_VISIT_ID, number: 3 },
    };
    // For the abscess; and one on the caries' tooth, made for no diagnosis.
    const rootCanal = treatmentPlan(30, 'Root canal treatment', '46', {
      ...completed,
      diagnosisRecordId: abscess.id,
    });
    const inlay = treatmentPlan(32, 'Inlay', '37', completed);
    expect(
      listed(
        visit({ services: [] }),
        chart({ diagnoses: [abscess, caries], plans: [rootCanal, inlay] }),
      ),
    ).toEqual([
      ['Abscess', ['Root canal treatment']],
      ['Deep caries', ['Inlay']],
    ]);
  });

  it('names every plan for the diagnosis performed today', () => {
    const caries = diagnosisRecord(10, 'Deep caries', '16');
    const post = treatmentPlan(30, 'Post and core', '17', { diagnosisRecordId: caries.id });
    const crown = treatmentPlan(32, 'Crown', '17', { diagnosisRecordId: caries.id });
    const services = [
      visitService(20, 'Post and core', '17', { planId: post.id }),
      visitService(22, 'Crown', '17', { planId: crown.id }),
    ];
    expect(
      listed(visit({ services }), chart({ diagnoses: [caries], plans: [post, crown] })),
    ).toEqual([['Deep caries', ['Post and core', 'Crown']]]);
  });

  it('lists nothing for a resolved diagnosis, another tooth, work only started, or a jaw service', () => {
    const resolved = diagnosisRecord(10, 'Deep caries', '16', { status: 'resolved' });
    const elsewhere = diagnosisRecord(12, 'Abscess', '36');
    const started = treatmentPlan(30, 'Root canal treatment', '36', {
      status: 'in_progress',
      diagnosisRecordId: elsewhere.id,
    });
    const services = [
      visitService(20, 'Composite', '16'),
      visitService(22, 'Scaling', null, { chargeUnit: 'per_jaw', jaw: 'lower' }),
    ];
    expect(
      listed(visit({ services }), chart({ diagnoses: [resolved, elsewhere], plans: [started] })),
    ).toEqual([]);
  });
});
