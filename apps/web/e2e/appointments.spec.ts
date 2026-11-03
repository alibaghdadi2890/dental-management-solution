import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

const PASSWORD = 'correct-horse-battery';
const TEMPORARY = 'temporary-pw-1';
const ORIGIN = 'http://localhost:5173';

interface Clinic {
  timeZone: string;
  owner: string;
  desk: string;
  deskId: string;
  dentistProfileId: string;
  branchId: string;
  roomId: string;
}

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

/**
 * A zone where it is mid-morning now, so the flows below, which book later today, pass at any hour:
 * late in the evening "later today" would be past the end of the day.
 */
function morningZone(): string {
  const offset = ((10 - new Date().getUTCHours() + 36) % 24) - 12;
  return offset >= 0 ? `Etc/GMT-${String(offset)}` : `Etc/GMT+${String(-offset)}`;
}

/** A clinic set up through the API: the flows under test are the calendar's, not provisioning's. */
async function provision(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const context = await browser.newContext({ baseURL: ORIGIN });
  const api = apiFor(context.request);
  await signInApi(api, E2E_ADMIN.email, E2E_ADMIN.password);
  const owner = `sched-owner-${run}@e2e.test`;
  await api('POST', '/platform/tenants', {
    clinic: { name: `Schedule ${run}`, slug: `sched-${run}` },
    firstBranch: { name: 'Main St' },
    owner: { displayName: 'Dr. Ana Reyes', email: owner, temporaryPassword: TEMPORARY },
  });
  await context.clearCookies();
  await signInApi(api, owner, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  const [branch] = (await api('GET', '/branches')) as { id: string }[];
  if (!branch) throw new Error('no branch');
  const timeZone = morningZone();
  await api('PATCH', '/tenant', { timeZone });
  await api('PUT', `/scheduling/branches/${branch.id}/opening-hours`, {
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
      from: '08:00',
      to: '18:00',
    })),
  });
  const rooms = (await api('POST', '/rooms/batch', {
    items: ['1', '2'].map((n) => ({
      branchId: branch.id,
      name: `Room ${n}`,
      code: `R${n}`,
      active: true,
    })),
  })) as { id: string }[];
  const desk = `sched-desk-${run}@e2e.test`;
  const staff = (await api('POST', '/users', {
    displayName: 'Jamie Ortiz',
    email: desk,
    practitionerType: 'assistant',
    roleKeys: ['frontdesk'],
    branchIds: [branch.id],
    temporaryPassword: TEMPORARY,
  })) as { id: string };
  const users = (await api('GET', '/users')) as { email: string; profileId: string }[];
  const dentist = users.find((user) => user.email === owner);
  if (!dentist) throw new Error('no owner profile');
  await context.clearCookies();
  await signInApi(api, desk, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  await context.close();
  return {
    timeZone,
    owner,
    desk,
    deskId: staff.id,
    dentistProfileId: dentist.profileId,
    branchId: branch.id,
    roomId: rooms[0]?.id ?? '',
  };
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

/** A patient and an appointment later today, through the API as the front desk. */
async function bookToday(page: Page, name: string, durationMin = 30, offsetMin = 60) {
  const api = apiFor(page.request);
  const patient = (await api(
    'POST',
    '/patients',
    { fullName: name, phone: '+96170123456' },
    crypto.randomUUID(),
  )) as { id: string };
  const startsAt = new Date(Date.now() + offsetMin * 60_000);
  startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 15) * 15, 0, 0);
  await api(
    'POST',
    '/scheduling/appointments',
    {
      branchId: clinic.branchId,
      patientId: patient.id,
      dentistId: clinic.dentistProfileId,
      startsAt: startsAt.toISOString(),
      durationMin,
      reason: 'Check-up',
      confirmed: true,
      override: true,
    },
    crypto.randomUUID(),
  );
  return patient.id;
}

test('a phone booking with a quick patient, through check-in, a visit and the checkout', async ({
  browser,
}) => {
  test.slow();
  const desk = await browser.newPage();
  await signIn(desk, clinic.desk);

  await test.step('the front desk books someone who is not registered yet', async () => {
    await desk.goto('/schedule');
    await desk.getByRole('button', { name: 'New appointment' }).click();
    const panel = desk.getByRole('complementary', { name: 'New appointment' });
    await panel.getByPlaceholder('Name, phone or patient ID').fill('Zed Haddad');
    await panel.getByRole('button', { name: /New patient "Zed Haddad"/ }).click();
    await expect(panel.getByLabel('First name')).toHaveValue('Zed');
    await expect(panel.getByLabel('Last name')).toHaveValue('Haddad');
    await panel.getByRole('textbox', { name: 'Phone', exact: true }).fill('+96170999888');
    await panel.getByRole('button', { name: 'Add patient' }).click();
    await panel.getByRole('button', { name: 'Check-up' }).click();
    await panel.getByRole('button', { name: 'Dr. Ana Reyes' }).click();
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: clinic.timeZone,
      hour: '2-digit',
    }).format(Date.now() + 2 * 3_600_000);
    await panel.getByLabel('Start time').selectOption(`${hour}:00`);
    await expect(panel.getByRole('button', { name: 'Confirm booking' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(desk.getByRole('status').filter({ hasText: 'Appointment booked' })).toBeVisible();
    await expect(desk.locator('.rbc-event').filter({ hasText: 'Zed Haddad' })).toContainText(
      'Incomplete',
    );
  });

  await test.step('checks them in; the board shows them waiting', async () => {
    await desk.locator('.rbc-event').filter({ hasText: 'Zed Haddad' }).click();
    await desk
      .getByRole('dialog', { name: 'Appointment' })
      .getByRole('button', {
        name: 'Check in',
      })
      .click();
    await expect(desk.getByRole('status').filter({ hasText: 'Checked in' })).toBeVisible();
    await desk.goto('/today');
    await expect(desk.getByRole('region', { name: 'Waiting · 1' })).toContainText('Zed Haddad');
  });

  const dentist = await browser.newPage();
  await signIn(dentist, clinic.owner);

  await test.step('the dentist starts the visit from the appointment and recommends a follow-up', async () => {
    await dentist.goto('/today');
    await dentist
      .getByRole('region', { name: 'Waiting · 1' })
      .getByRole('button', { name: 'Start visit' })
      .click();
    await expect(dentist.getByRole('button', { name: /^Start/ })).toHaveCount(2);
    await dentist
      .getByRole('button', { name: /^Start/ })
      .last()
      .click();
    await expect(dentist).toHaveURL(/\/visits\//);
    await dentist.getByRole('radio', { name: 'All', exact: true }).click();
    await dentist.getByRole('button', { name: 'Review & complete' }).click();
    await dentist
      .getByRole('dialog', { name: 'Complete visit' })
      .getByRole('button', { name: 'Complete visit' })
      .click();
    const next = dentist.getByRole('dialog', { name: 'Next appointment' });
    await next.getByRole('button', { name: 'Healing review' }).click();
    await next.getByRole('button', { name: 'Complete visit · send to front desk' }).click();
    await expect(dentist.getByRole('dialog', { name: 'Visit recorded' })).toBeVisible();
    await dentist.close();
  });

  await test.step('the front desk books it at checkout', async () => {
    await desk.goto('/today');
    const lane = desk.getByRole('region', { name: /Ready for checkout/ });
    await expect(lane).toContainText('Follow-up to schedule');
    await lane.getByRole('button', { name: 'Check out Zed Haddad' }).click();
    const checkout = desk.getByRole('dialog', { name: 'Checkout · Zed Haddad' });
    await checkout.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(checkout).toContainText('Healing review');
    await expect(checkout).toContainText('Awaiting scheduling');
    await checkout.getByRole('button', { name: 'Find available slots' }).click();
    await checkout.locator('ul button').first().click();
    await checkout.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(checkout).toContainText('Next appointment booked');
  });
  await desk.close();
});

test('dragging a card asks first, and the bottom edge changes the duration', async ({ page }) => {
  await signIn(page, clinic.desk);
  await bookToday(page, `Kenji Park ${Date.now().toString(36)}`, 30, 120);
  await page.goto('/schedule');
  const card = page.locator('.rbc-event').filter({ hasText: 'Kenji Park' });
  await expect(card).toBeVisible();

  await test.step('a resize confirms and saves the same row', async () => {
    const box = await card.boundingBox();
    if (!box) throw new Error('no card');
    const x = box.x + 40;
    const y = box.y + box.height - 4;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60, { steps: 6 });
    await page.mouse.up();
    const confirm = page.getByRole('dialog', { name: 'Confirm the change' });
    await expect(confirm).toContainText(/Change duration to \d+ min\?/);
    await confirm.getByRole('button', { name: 'Change duration' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Duration changed' })).toBeVisible();
  });

  await test.step('a move shows the confirmation; cancelling leaves the card', async () => {
    const box = await card.boundingBox();
    if (!box) throw new Error('no card');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 40, { steps: 4 });
    await page.mouse.move(from.x, from.y - 84, { steps: 4 });
    await page.mouse.up();
    const confirm = page.getByRole('dialog', { name: 'Confirm the change' });
    await expect(confirm).toContainText('Move Kenji Park');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect((await card.boundingBox())?.y).toBeCloseTo(box.y, 0);
  });
});

test('the worklist lists a follow-up, books it away, and a cancellation brings it back', async ({
  browser,
}) => {
  test.slow();
  const dentist = await browser.newPage();
  await signIn(dentist, clinic.owner);
  const api = apiFor(dentist.request);
  const name = `Maya Okafor ${Date.now().toString(36)}`;
  const patient = (await api(
    'POST',
    '/patients',
    { fullName: name, phone: '+96170123456' },
    crypto.randomUUID(),
  )) as { id: string };
  const { visit } = (await api('POST', '/visits', {
    patientId: patient.id,
    dentistId: clinic.dentistProfileId,
    roomId: clinic.roomId,
    type: 'examination',
  })) as { visit: { id: string } };
  await api('POST', `/visits/${visit.id}/complete`, {
    nextAppointment: {
      kind: 'healing_review',
      title: 'Healing review',
      durationMin: 15,
      timing: 'within_1_week',
    },
  });
  await dentist.close();

  const desk = await browser.newPage();
  await signIn(desk, clinic.desk);
  await desk.goto('/today');
  const list = desk.getByRole('region', { name: /Follow-ups to schedule/ });
  const row = list.getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText('Healing review');

  await test.step('Schedule books it through the slot finder and removes the row', async () => {
    await row.getByRole('button', { name: 'Schedule' }).click();
    const finder = desk.getByRole('dialog', { name: 'Find available slots' });
    await finder.locator('ul button').first().click();
    await finder.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(finder).toBeHidden();
    await expect(row).toHaveCount(0);
  });

  await test.step('cancelling that appointment puts the row back', async () => {
    const appointments = (await apiFor(desk.request)(
      'GET',
      `/scheduling/patients/${patient.id}/appointments`,
    )) as { id: string }[];
    await apiFor(desk.request)('POST', `/scheduling/appointments/${appointments[0]?.id}/cancel`, {
      reason: 'Travelling',
    });
    await desk.reload();
    await expect(
      desk.getByRole('region', { name: /Follow-ups to schedule/ }).getByText(name),
    ).toBeVisible();
  });
  await desk.close();
});

test('the front desk checks in and starts the visit; the dentist is alerted and opens it', async ({
  browser,
}) => {
  test.slow();
  const name = `Lina Haddad ${Date.now().toString(36)}`;
  const dentist = await browser.newPage();
  await signIn(dentist, clinic.owner);
  await dentist.goto('/today');
  await expect(dentist.getByRole('button', { name: /^Your patients/ })).toBeVisible();

  const desk = await browser.newPage();
  await signIn(desk, clinic.desk);
  await bookToday(desk, name, 30, 30);
  await desk.goto('/schedule');
  const card = desk.locator('.rbc-event').filter({ hasText: name });

  await test.step('checking in alerts the dentist', async () => {
    await card.click();
    await desk
      .getByRole('dialog', { name: 'Appointment' })
      .getByRole('button', { name: 'Check in' })
      .click();
    await expect(desk.getByRole('status').filter({ hasText: 'Checked in' })).toBeVisible();
    await expect(dentist.getByRole('status').filter({ hasText: `${name} arrived` })).toBeVisible();
  });

  await test.step('the front desk starts the visit from the side panel and stays', async () => {
    await card.click();
    await desk
      .getByRole('dialog', { name: 'Appointment' })
      .getByRole('button', { name: 'Start visit' })
      .click();
    const panel = desk.getByRole('complementary', { name: 'Start visit' });
    await panel.getByLabel('Room').selectOption({ label: 'Room 1' });
    await panel.getByRole('button', { name: 'Start visit' }).click();
    await expect(
      desk.getByRole('status').filter({ hasText: 'Visit started · Dr. Ana Reyes · Room 1' }),
    ).toBeVisible();
    await expect(desk).toHaveURL(/\/schedule/);
  });

  await test.step('the dentist opens the visit from the alert', async () => {
    const alert = dentist.getByRole('status').filter({ hasText: `${name} is in Room 1` });
    await expect(alert).toContainText('started by Jamie Ortiz');
    await alert.getByRole('button', { name: 'Open' }).click();
    await expect(dentist).toHaveURL(/\/visits\//);
  });
  await desk.close();
  await dentist.close();
});
