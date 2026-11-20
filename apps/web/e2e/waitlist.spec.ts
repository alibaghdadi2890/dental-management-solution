import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

const PASSWORD = 'correct-horse-battery';
const TEMPORARY = 'temporary-pw-1';
const ORIGIN = 'http://localhost:5173';

type Api = (method: string, path: string, data?: unknown, key?: string) => Promise<unknown>;

const apiFor =
  (request: APIRequestContext): Api =>
  async (method, path, data, key) => {
    const response = await request.fetch(`/api/v1${path}`, {
      method,
      ...(data === undefined ? {} : { data }),
      headers: { origin: ORIGIN, ...(key ? { 'Idempotency-Key': key } : {}) },
    });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  };

const signInApi = (api: Api, email: string, password: string) =>
  api('POST', '/auth/sign-in/email', { email, password, rememberMe: true });

interface Clinic {
  /** Hours ahead of UTC: a fixed zone where it is mid-morning now. */
  offset: number;
  timeZone: string;
  desk: string;
  dentistId: string;
  branchId: string;
}

/** Mid-morning now, so the days below are the same whatever the hour (as appointments.spec). */
function morningOffset(): number {
  return ((10 - new Date().getUTCHours() + 36) % 24) - 12;
}

async function provision(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const context = await browser.newContext({ baseURL: ORIGIN });
  const api = apiFor(context.request);
  await signInApi(api, E2E_ADMIN.email, E2E_ADMIN.password);
  const owner = `wait-owner-${run}@e2e.test`;
  await api('POST', '/platform/tenants', {
    clinic: { name: `Waitlist ${run}`, slug: `wait-${run}` },
    firstBranch: { name: 'Main St' },
    owner: { displayName: 'Dr. Ana Reyes', email: owner, temporaryPassword: TEMPORARY },
  });
  await context.clearCookies();
  await signInApi(api, owner, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  const [branch] = (await api('GET', '/branches')) as { id: string }[];
  if (!branch) throw new Error('no branch');
  const offset = morningOffset();
  const timeZone = offset >= 0 ? `Etc/GMT-${String(offset)}` : `Etc/GMT+${String(-offset)}`;
  await api('PATCH', '/tenant', { timeZone });
  await api('PUT', `/scheduling/branches/${branch.id}/opening-hours`, {
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
      from: '08:00',
      to: '18:00',
    })),
  });
  await api('POST', '/rooms/batch', {
    items: ['1', '2'].map((n) => ({
      branchId: branch.id,
      name: `Room ${n}`,
      code: `R${n}`,
      active: true,
    })),
  });
  const desk = `wait-desk-${run}@e2e.test`;
  await api('POST', '/users', {
    displayName: 'Jamie Ortiz',
    email: desk,
    practitionerType: 'assistant',
    roleKeys: ['frontdesk'],
    branchIds: [branch.id],
    temporaryPassword: TEMPORARY,
  });
  const users = (await api('GET', '/users')) as { email: string; profileId: string }[];
  const dentist = users.find((user) => user.email === owner);
  if (!dentist) throw new Error('no owner profile');
  await context.clearCookies();
  await signInApi(api, desk, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  await context.close();
  return { offset, timeZone, desk, dentistId: dentist.profileId, branchId: branch.id };
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

let clinic: Clinic;

test.beforeAll(async ({ browser }) => {
  clinic = await provision(browser);
});

/** The clinic-local day `days` from today. */
const dayIn = (days: number) =>
  new Date(Date.now() + clinic.offset * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
const instant = (day: string, time: string) => {
  const sign = clinic.offset >= 0 ? '+' : '-';
  const hours = String(Math.abs(clinic.offset)).padStart(2, '0');
  return new Date(`${day}T${time}:00${sign}${hours}:00`).toISOString();
};

test('the waitlist: book with the tick, cancel another, Fill, the move, the chain', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.desk);
  const api = apiFor(page.request);
  const run = Date.now().toString(36);
  const patient = async (name: string) =>
    (
      (await api(
        'POST',
        '/patients',
        { fullName: `${name} ${run}`, phone: '+96170123456' },
        crypto.randomUUID(),
      )) as { id: string }
    ).id;
  const book = async (patientId: string, day: string, time: string, durationMin = 60) =>
    (
      (await api(
        'POST',
        '/scheduling/appointments',
        {
          branchId: clinic.branchId,
          patientId,
          dentistId: clinic.dentistId,
          startsAt: instant(day, time),
          durationMin,
          reason: 'Check-up',
          confirmed: true,
          override: true,
        },
        crypto.randomUUID(),
      )) as { id: string }
    ).id;
  const openingDay = dayIn(2);
  const laterDay = dayIn(5);
  // Dr. Reyes is busy around both times, so each freed hour is one opening of its own.
  for (const [day, time] of [
    [laterDay, '09:00'],
    [laterDay, '11:00'],
    [openingDay, '14:00'],
    [openingDay, '16:00'],
  ] as const) {
    await book(await patient('Filler'), day, time);
  }
  const rami = await patient('Rami');
  const noor = await patient('Noor');
  const kenji = await patient('Kenji');

  await test.step('the front desk books Rami and ticks Wants an earlier time', async () => {
    await page.goto(`/schedule?date=${laterDay}&bookFor=${rami}`);
    const panel = page.getByRole('complementary', { name: 'New appointment' });
    await panel.getByRole('button', { name: 'Check-up' }).click();
    await panel.getByRole('button', { name: '60 min' }).click();
    await panel.getByLabel('Start time').selectOption('10:00');
    await panel.getByRole('checkbox', { name: 'Wants an earlier time' }).check();
    await panel.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Appointment booked' })).toBeVisible();
    const card = page.locator('.rbc-event').filter({ hasText: `Rami ${run}` });
    await expect(card.getByRole('img', { name: 'Wants an earlier time' })).toBeVisible();
  });

  // Noor waits with no appointment, added after Rami: she is second.
  await api('POST', '/scheduling/waitlist', {
    branchId: clinic.branchId,
    patientId: noor,
    dentistId: clinic.dentistId,
    reason: 'Crown prep',
    durationMin: 45,
  });
  const kenjis = await book(kenji, openingDay, '15:00');

  await test.step("cancelling Kenji's hour says who fits it, and Fill lists them", async () => {
    await page.goto(`/schedule?date=${openingDay}&appointment=${kenjis}`);
    const popover = page.getByRole('dialog', { name: 'Appointment' });
    await popover.getByRole('button', { name: 'Cancel', exact: true }).click();
    await popover.getByRole('button', { name: 'Cancel appointment' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Appointment cancelled' });
    await expect(toast).toContainText('2 on the waitlist fit');
    await toast.getByRole('button', { name: 'Fill' }).click();
  });

  const fill = page.getByRole('dialog', { name: 'Fill opening' });
  await test.step('Book moves Rami into the opening, confirmed', async () => {
    const rows = fill.getByRole('listitem');
    await expect(rows.nth(0)).toContainText(`Rami ${run}`);
    await expect(rows.nth(1)).toContainText(`Noor ${run}`);
    await rows.nth(0).getByRole('button', { name: 'Book' }).click();
    await expect(fill.getByRole('checkbox', { name: 'Confirmed with patient' })).toBeChecked();
    await fill.getByRole('button', { name: 'Move', exact: true }).click();
    const toast = page.getByRole('status').filter({ hasText: 'booked from the waitlist' });
    await expect(toast).toContainText('1 on the waitlist fits');
    await toast.getByRole('button', { name: 'Fill' }).click();
  });

  await test.step('the chain: his old hour goes to Noor', async () => {
    await expect(fill.getByRole('listitem')).toHaveCount(1);
    await fill.getByRole('listitem').getByRole('button', { name: 'Book' }).click();
    await fill.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Noor ${run} booked from the waitlist` }),
    ).toBeVisible();
  });

  const ramis = (await api('GET', `/scheduling/patients/${rami}/appointments`)) as {
    startsAt: string;
    status: string;
    fromWaitlist: boolean;
  }[];
  expect(ramis.find((item) => item.status === 'confirmed')).toMatchObject({
    startsAt: instant(openingDay, '15:00'),
    fromWaitlist: true,
  });
  const noors = (await api('GET', `/scheduling/patients/${noor}/appointments`)) as {
    startsAt: string;
    endsAt: string;
  }[];
  expect(noors[0]).toMatchObject({
    startsAt: instant(laterDay, '10:00'),
    endsAt: instant(laterDay, '10:45'),
  });
});
