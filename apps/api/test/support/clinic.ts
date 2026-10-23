import type {
  Branch,
  PractitionerType,
  Room,
  ServiceItem,
  StaffUser,
  Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { expect } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from './session';
import type { TestApp } from './test-app';

const TEMPORARY = 'temporary-pw-1';

export interface StaffMember {
  agent: TestAgent;
  user: StaffUser;
}

/** A provisioned clinic: its owner signed in, one branch, one room and one service. */
export interface TestClinic {
  admin: TestAgent;
  tenant: Tenant;
  branch: Branch;
  room: Room;
  /** A second room, so two visits can be live at once. */
  spareRoom: Room;
  service: ServiceItem;
  owner: TestAgent;
  /** A new staff user with these roles, signed in. */
  staff(
    roleKeys: string[],
    displayName: string,
    practitionerType?: PractitionerType,
  ): Promise<StaffMember>;
}

/** Asserts the status and returns the body. */
export const ok = async <T>(
  request: PromiseLike<{ status: number; body: unknown }>,
  status = 200,
): Promise<T> => {
  const response = await request;
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body as T;
};

/** Provisions a clinic end to end as a platform admin would (ADR-0009), then its owner. */
export async function provisionClinic(testApp: TestApp, name: string): Promise<TestClinic> {
  const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
    rememberMe: true,
  });
  const ownerEmail = uniqueEmail('owner');
  const tenant = await ok<Tenant>(
    admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `c-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    }),
    201,
  );
  const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
  const [branch] = await ok<Branch[]>(owner.get('/api/v1/branches'));
  if (!branch) throw new Error('provisioning created no branch');
  const rooms = await ok<Room[]>(
    owner.post('/api/v1/rooms/batch').send({
      items: [
        { branchId: branch.id, name: 'Room 1', code: 'R1', active: true },
        { branchId: branch.id, name: 'Room 2', code: 'R2', active: true },
      ],
    }),
  );
  const [room, spareRoom] = rooms;
  if (!room || !spareRoom) throw new Error('no rooms');
  const services = await ok<ServiceItem[]>(
    owner.put('/api/v1/catalog/services').send({
      items: [{ code: 'ZFILL', name: 'Filling', chargeUnit: 'per_tooth', price: '50' }],
    }),
  );
  const service = services.find((item) => item.code === 'ZFILL');
  if (!service) throw new Error('no service');

  const staff = async (
    roleKeys: string[],
    displayName: string,
    practitionerType: PractitionerType = 'dentist',
  ): Promise<StaffMember> => {
    const email = uniqueEmail(roleKeys[0] ?? 'staff');
    const user = await ok<StaffUser>(
      owner.post('/api/v1/users').send({
        displayName,
        email,
        practitionerType,
        roleKeys,
        branchIds: [branch.id],
        temporaryPassword: TEMPORARY,
      }),
      201,
    );
    return { agent: await signInAndSetPassword(testApp.app, email, TEMPORARY), user };
  };

  return { admin, tenant, branch, room, spareRoom, service, owner, staff };
}

/**
 * What a dentist could do before ADR-0055 (every visit, discounts, payments, refunds): suites
 * written before it that are about something else give their dentist these, as an owner would.
 */
export const FORMER_DENTIST_GRANTS = [
  'visit:read_all',
  'visit:discount',
  'payment:write',
  'payment:refund',
  'finance:read',
] as const;

/** The owner grants `userId` additional permissions (ADR-0055). */
export async function grant(
  owner: TestAgent,
  userId: string,
  permissions: readonly string[] = FORMER_DENTIST_GRANTS,
): Promise<void> {
  await ok(owner.put(`/api/v1/users/${userId}/grants`).send({ permissions }));
}
