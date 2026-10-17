import { describe, expect, it } from 'vitest';
import {
  chart,
  diagnosisRecord,
  treatmentPlan,
  visit,
  visitService,
} from '../workspace/workspace.test-utils';
import { diagnosesToResolve } from './diagnoses-to-resolve';

const listed = (...args: Parameters<typeof diagnosesToResolve>) =>
  diagnosesToResolve(...args).map(({ record, services }) => [
    record.name,
    services.map((service) => service.name),
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
