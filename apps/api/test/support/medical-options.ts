import type { MedicalOption, MedicalOptionKind } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';

/** A history as a patient create or edit sends it; unset parts mean "not asked". */
export const historyInput = (
  patch: {
    noKnownAllergies?: boolean;
    allergyIds?: string[];
    noConditions?: boolean;
    conditionIds?: string[];
    medication?: string | null;
  } = {},
) => ({
  noKnownAllergies: false,
  allergyIds: [],
  noConditions: false,
  conditionIds: [],
  medication: null,
  ...patch,
});

/**
 * The clinic's allergy and condition lists, seeded with the defaults if the provisioning
 * subscriber has not got there yet (the seed is idempotent). `agent` needs `catalog:write`.
 */
export async function medicalOptions(agent: TestAgent): Promise<{
  all: MedicalOption[];
  /** The id of the option with this name in this list. */
  id: (kind: MedicalOptionKind, name: string) => string;
}> {
  const seeded = await agent.post('/api/v1/medical-history/options/seed-default');
  if (seeded.status !== 200) throw new Error(`seeding the lists answered ${seeded.status}`);
  const all = (await agent.get('/api/v1/medical-history/options')).body as MedicalOption[];
  return {
    all,
    id: (kind, name) => {
      const option = all.find((item) => item.kind === kind && item.name === name);
      if (!option) throw new Error(`no ${kind} named ${name}`);
      return option.id;
    },
  };
}
