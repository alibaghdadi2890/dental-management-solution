import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGNOSES, DEFAULT_SERVICES } from './default-catalog';

const codes = (rows: readonly { code: string }[]) => rows.map((row) => row.code);
const flagged = (
  rows: readonly { code: string; frequent?: boolean; active?: boolean }[],
  key: 'frequent' | 'active',
  value: boolean,
) => rows.filter((row) => row[key] === value).map((row) => row.code);

/** The POC's `CATALOG` and `DX_CATALOG` (clinic-data.js), in order (C3). */
describe('default catalog template', () => {
  it('has the POC services with their prices and charge units', () => {
    expect(
      DEFAULT_SERVICES.map((row) => [row.code, row.name, row.category, row.chargeUnit, row.price]),
    ).toEqual([
      ['EXT', 'Extraction', 'Surgical', 'per_tooth', '30'],
      ['CLT', 'Crown lengthening', 'Surgical', 'per_tooth', '15'],
      ['PARO', 'Periodontal treatment', 'Periodontal', 'per_tooth', '30'],
      ['PARX', 'Periodontal treatment / jaw', 'Periodontal', 'per_jaw', '50'],
      ['CMP', 'Composite', 'Restorative', 'per_tooth', '50'],
      ['CGIC', 'Composite GIC', 'Restorative', 'per_tooth', '80'],
      ['CBIO', 'Composite Bio', 'Restorative', 'per_tooth', '100'],
      ['ONL', 'Onlay / inlay', 'Prosthetic', 'per_tooth', '250'],
      ['MCC', 'Metal-ceramic crown', 'Prosthetic', 'per_tooth', '250'],
      ['ZIR', 'Zircon crown', 'Prosthetic', 'per_tooth', '350'],
      ['SCL', 'Scaling & polishing', 'Periodontal', 'per_mouth', '60'],
      ['XRY', 'Periapical X-ray', 'Diagnostic', 'per_tooth', '20'],
    ]);
  });

  it('has the POC diagnoses', () => {
    expect(DEFAULT_DIAGNOSES.map((row) => [row.code, row.name, row.category])).toEqual([
      ['DX-CAR', 'Dental caries', 'Caries'],
      ['DX-DEEP', 'Deep caries', 'Caries'],
      ['DX-SEC', 'Secondary caries', 'Caries'],
      ['DX-PULP', 'Irreversible pulpitis', 'Pulpal'],
      ['DX-RPUL', 'Reversible pulpitis', 'Pulpal'],
      ['DX-NEC', 'Pulp necrosis', 'Pulpal'],
      ['DX-APX', 'Apical periodontitis', 'Pulpal'],
      ['DX-FRAC', 'Cracked tooth', 'Structural'],
      ['DX-ATTR', 'Attrition', 'Structural'],
      ['DX-GIN', 'Gingivitis', 'Periodontal'],
      ['DX-PERIO', 'Chronic periodontitis', 'Periodontal'],
      ['DX-REC', 'Gingival recession', 'Periodontal'],
      ['DX-SENS', 'Dentine hypersensitivity', 'Other'],
      ['DX-BRUX', 'Bruxism', 'Other'],
    ]);
  });

  it('keeps the POC inactive rows inactive', () => {
    expect(flagged(DEFAULT_SERVICES, 'active', false)).toEqual(['XRY']);
    expect(flagged(DEFAULT_DIAGNOSES, 'active', false)).toEqual(['DX-BRUX']);
  });

  it('marks the workspace spec "Frequently used" rows', () => {
    expect(flagged(DEFAULT_SERVICES, 'frequent', true)).toEqual(['EXT', 'CMP', 'CGIC', 'ZIR']);
    expect(flagged(DEFAULT_DIAGNOSES, 'frequent', true)).toEqual([
      'DX-CAR',
      'DX-DEEP',
      'DX-GIN',
      'DX-SENS',
    ]);
  });

  it('has unique codes in each catalog', () => {
    expect(new Set(codes(DEFAULT_SERVICES)).size).toBe(DEFAULT_SERVICES.length);
    expect(new Set(codes(DEFAULT_DIAGNOSES)).size).toBe(DEFAULT_DIAGNOSES.length);
  });
});
