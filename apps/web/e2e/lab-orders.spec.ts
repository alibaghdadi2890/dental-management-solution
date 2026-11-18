import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';
import { openAllView, skipNextAppointment } from './start-visit';

/**
 * Feature 18, lab orders: the story of its acceptance — the owner registers a lab, a dentist orders
 * a crown from a visit, sends it, the patient is booked, the work is late on Today, arrives, is
 * fitted in the next visit, and the lab is paid; the payment is a Lab fees expense. Then the front
 * desk, who works with orders but never sees lab money.
 */
const PASSWORD = 'correct-horse-battery';
const TEMPORARY = 'temporary-pw-1';
const ORIGIN = 'http://localhost:5173';
const PATIENT = 'Rami Haddad';

interface Clinic {
  timeZone: string;
  owner: string;
  desk: string;
  branchId: string;
  dentistProfileId: string;
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

/** A zone where it is mid-morning now, so an appointment "later today" is still today. */
function morningZone(): string {
  const offset = ((10 - new Date().getUTCHours() + 36) % 24) - 12;
  return offset >= 0 ? `Etc/GMT-${String(offset)}` : `Etc/GMT+${String(-offset)}`;
}

/** The clinic's today, shifted by `days`, as ISO and as typed in the clinic's day/month order. */
function day(timeZone: string, days: number): { iso: string; typed: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const iso = date.toISOString().slice(0, 10);
  const [year, month, dayOfMonth] = iso.split('-');
  return { iso, typed: `${dayOfMonth ?? ''}/${month ?? ''}/${year ?? ''}` };
}

/** A clinic set up through the API: the flows under test are the lab's, not provisioning's. */
async function provision(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const context = await browser.newContext({ baseURL: ORIGIN });
  const api = apiFor(context.request);
  await signInApi(api, E2E_ADMIN.email, E2E_ADMIN.password);
  const owner = `lab-owner-${run}@e2e.test`;
  await api('POST', '/platform/tenants', {
    clinic: { name: `Lab ${run}`, slug: `lab-${run}` },
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
  await api('POST', '/rooms/batch', {
    items: [{ branchId: branch.id, name: 'Room 1', code: 'R1', active: true }],
  });
  const desk = `lab-desk-${run}@e2e.test`;
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
  await api('POST', '/patients', { fullName: PATIENT, phone: '+96170123456' }, crypto.randomUUID());
  await context.clearCookies();
  await signInApi(api, desk, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  await context.close();
  return { timeZone, owner, desk, branchId: branch.id, dentistProfileId: dentist.profileId };
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

async function openRecord(page: Page) {
  await page.getByRole('link', { name: 'Patients', exact: true }).click();
  await page
    .getByRole('table', { name: 'Patients' })
    .getByRole('row')
    .filter({ hasText: PATIENT })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: PATIENT })).toBeVisible();
}

const steps = (page: Page) => page.getByRole('navigation', { name: 'Treatment visit steps' });

/** From the record: a Treatment visit in Room 1, once the workspace (not the record) is on screen. */
async function startTreatmentVisit(page: Page, notice?: string) {
  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  if (notice) await expect(popover).toContainText(notice);
  await popover.getByRole('radio', { name: /^Treatment/ }).check();
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 1' });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(steps(page)).toBeVisible();
}

/**
 * From the Complete step: the check of finished work when entering it asked (work was done), then
 * Complete visit, the check before it when it asks, and Skip on Next appointment.
 */
async function completeVisit(page: Page) {
  const entering = page.getByRole('dialog', { name: 'Before you complete' });
  const complete = page.getByRole('button', { name: 'Complete visit' });
  await expect(entering.or(complete)).toBeVisible();
  if (await entering.isVisible()) {
    await entering.getByRole('button', { name: 'Continue to Complete' }).click();
  }
  await complete.click();
  const check = page.getByRole('dialog', { name: 'Before you complete' });
  const next = page.getByRole('dialog', { name: 'Next appointment' });
  await expect(check.or(next)).toBeVisible();
  if (await check.isVisible()) {
    await check.getByRole('button', { name: 'Complete visit' }).click();
  }
  await skipNextAppointment(page);
  await expect(page.getByRole('dialog', { name: 'Visit recorded' })).toBeVisible();
}

let clinic: Clinic;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  clinic = await provision(browser);
});

test('a crown from a visit to the lab, late, arrived, fitted, and the lab paid', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.owner);

  await test.step('the owner registers Smile Lab and its zirconia crown', async () => {
    await page.getByRole('link', { name: 'Lab', exact: true }).click();
    await page.getByRole('tab', { name: 'Labs' }).click();
    await page.getByRole('button', { name: 'Add lab' }).click();
    const panel = page.getByRole('dialog', { name: 'Add a lab' });
    // Saving empty says what is missing, and nothing is created.
    await panel.getByRole('button', { name: 'Add lab' }).click();
    await expect(panel.getByText('Required')).toBeVisible();
    await panel.getByLabel('Name', { exact: true }).fill('Smile Lab');
    await panel.getByLabel('Phone').fill('+961 1 234 567');
    await panel.getByLabel('Standard turnaround').fill('7');
    await panel.getByRole('button', { name: 'Add lab' }).click();
    await expect(toast(page, 'Smile Lab added')).toBeVisible();

    // The new lab's own page opens on its price list.
    await expect(page).toHaveURL(/\/labs\/[0-9a-f-]{36}\?tab=services$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Smile Lab' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Add service' }).click();
    const service = page.getByRole('dialog', { name: 'Add service' });
    await service.getByLabel('Service').fill('Zirconia crown');
    await service.getByLabel('Price').fill('120');
    await service.getByLabel('Turnaround').fill('5');
    await service.getByRole('button', { name: 'Add service' }).click();
    await expect(toast(page, 'Service added')).toBeVisible();
    await expect(page.getByRole('row', { name: /Zirconia crown.*\$120.*5 days/ })).toBeVisible();
  });

  await test.step('a visit works on #15 and #16, then orders the crown on #16', async () => {
    await openRecord(page);
    await startTreatmentVisit(page);
    await openAllView(page);
    const chart = page.getByRole('region', { name: 'Dental chart' });
    const selected = page.getByRole('complementary', { name: 'Selected tooth' });
    for (const label of ['#15', '#16']) {
      await chart.getByRole('button', { name: new RegExp(`^${label} · `) }).click();
      await selected.getByRole('button', { name: 'Add completed service', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Add completed service' });
      await drawer.getByRole('searchbox').fill('Composite');
      await drawer
        .getByRole('button')
        .filter({ has: page.getByText('Composite', { exact: true }) })
        .click();
      await expect(drawer).toBeHidden();
    }

    await page.getByRole('main').getByRole('button', { name: 'New lab order' }).click();
    const form = page.getByRole('dialog', { name: 'New lab order' });
    await expect(form.getByLabel('Patient')).toHaveValue(PATIENT);
    await form.getByLabel('Lab', { exact: true }).selectOption({ label: 'Smile Lab' });
    await form.getByLabel('Service').selectOption({ label: 'Zirconia crown · $120' });
    // From a visit the work is on teeth: the selected tooth is filled in, the visit's teeth offered.
    await expect(form.getByLabel('Where')).toHaveValue('teeth');
    await expect(form.getByLabel('Teeth')).toHaveValue('16');
    const offered = form.getByRole('group', { name: 'Worked on in this visit:' });
    await expect(offered.getByRole('button')).toHaveText(['#15', '#16']);
    await expect(offered.getByRole('button', { name: '#16' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await offered.getByRole('button', { name: '#15' }).click();
    await expect(form.getByLabel('Teeth')).toHaveValue('16 15');
    await offered.getByRole('button', { name: '#15' }).click();
    await expect(form.getByLabel('Teeth')).toHaveValue('16');
    await form.getByLabel('Shade').fill('A2');
    await form.getByRole('button', { name: 'Create order' }).click();
    await expect(toast(page, 'Lab order L-000001 created')).toBeVisible();

    await page.getByRole('radio', { name: 'Steps', exact: true }).click();
    await steps(page)
      .getByRole('button', { name: /^Complete/ })
      .click();
    await completeVisit(page);
  });

  await test.step('not sent yet, it is on Today at once, with Mark sent', async () => {
    await page.goto('/today');
    const row = page
      .getByRole('region', { name: 'Lab work' })
      .getByRole('listitem')
      .filter({ hasText: PATIENT });
    await expect(row).toContainText('Not sent');
    await expect(row.getByRole('button', { name: 'Mark sent' })).toBeVisible();
  });

  await test.step('sent nine days ago by courier: five days for a crown, so four days overdue', async () => {
    await page.goto('/lab');
    await page.getByRole('row', { name: /L-000001/ }).click();
    const panel = page.getByRole('dialog', { name: 'L-000001 · Smile Lab' });
    await expect(panel).toContainText('Zirconia crown #16 · Shade A2');
    await panel.getByRole('button', { name: 'Mark sent' }).click();
    const send = panel.getByRole('group', { name: 'Mark L-000001 sent' });
    const sentOn = send.getByLabel('Sent on');
    await sentOn.fill(day(clinic.timeZone, -9).typed);
    await send.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Order updated')).toBeVisible();
    await expect(panel.getByText('Overdue · 4 days')).toBeVisible();
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('row', { name: /L-000001/ })).toContainText('Overdue · 4 days');
  });

  await test.step('booked later today: the order follows the appointment', async () => {
    const startsAt = new Date(Date.now() + 60 * 60_000);
    startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 15) * 15, 0, 0);
    const patients = (await apiFor(page.request)('GET', '/patients?q=Rami')) as {
      items: { id: string }[];
    };
    await apiFor(page.request)(
      'POST',
      '/scheduling/appointments',
      {
        branchId: clinic.branchId,
        patientId: patients.items[0]?.id,
        dentistId: clinic.dentistProfileId,
        startsAt: startsAt.toISOString(),
        durationMin: 30,
        reason: 'Crown fitting',
        confirmed: true,
        override: true,
      },
      crypto.randomUUID(),
    );
    await page.reload();
    await expect(page.getByRole('row', { name: /L-000001/ })).not.toContainText('No appointment');
  });

  await test.step('Today: late for today’s appointment; Mark received, with an Undo', async () => {
    await page.getByRole('link', { name: 'Today' }).click();
    const lane = page.getByRole('region', { name: 'Lab work' });
    const row = lane.getByRole('listitem').filter({ hasText: PATIENT });
    await expect(row).toContainText('Overdue · 4 days');
    await expect(row).toContainText('Appointment today');
    // The row is brief; a click (or a hover) shows the rest.
    await row.getByRole('button', { name: `Lab work for ${PATIENT}: details` }).click();
    const details = page.getByRole('dialog').filter({ hasText: 'L-000001' });
    await expect(details).toContainText('Zirconia crown #16 · Shade A2');
    await expect(details).toContainText('Dr. Ana Reyes');
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await row.getByRole('button', { name: 'Mark received' }).click();
    const done = toast(page, 'L-000001 updated');
    await expect(done).toBeVisible();
    await expect(done.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  await test.step('the next visit says the work arrived, and Complete fits it', async () => {
    await openRecord(page);
    await startTreatmentVisit(page, 'Lab work arrived');
    await expect(page.getByRole('region', { name: 'Lab work arrived' })).toContainText('L-000001');

    await steps(page)
      .getByRole('button', { name: /^Complete/ })
      .click();
    const work = page.getByRole('region', { name: 'Lab work' });
    await work.getByRole('combobox', { name: 'Choose' }).selectOption({ label: 'Fitted' });
    await expect(toast(page, '1 lab order updated')).toBeVisible();
    await completeVisit(page);
  });

  await test.step('owed from its arrival: Smile Lab is paid 120 in cash', async () => {
    await page.goto('/lab?tab=labs');
    const row = page.getByRole('row', { name: /Smile Lab/ });
    await expect(row).toContainText('$120');
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Smile Lab' })).toBeVisible();
    // The statement shows the crown delivered.
    await expect(page.getByRole('table', { name: 'Statement' })).toContainText('L-000001');
    await page.getByRole('main').getByRole('button', { name: 'Record payment' }).click();
    const payment = page.getByRole('dialog', { name: 'Record payment' });
    await payment.getByRole('button', { name: 'Pay it all' }).click();
    await expect(payment.getByLabel('Amount')).toHaveValue('120.00');
    await payment.getByRole('radio', { name: 'Cash' }).click();
    await payment.getByRole('button', { name: 'Record payment' }).click();
    await expect(toast(page, 'Payment recorded')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('$0');
    await expect(page.getByRole('table', { name: 'Statement' })).toContainText('Payment');
  });

  await test.step('the payment is a Lab fees row in Expenses', async () => {
    await page.getByRole('link', { name: 'Expenses' }).click();
    await expect(page.getByRole('row', { name: /Lab fees.*Smile Lab.*\$120/ })).toBeVisible();
  });
});

test('the front desk works with orders but never sees lab money', async ({ page }) => {
  await signIn(page, clinic.desk);
  await page.getByRole('link', { name: 'Lab', exact: true }).click();
  await page.getByRole('combobox', { name: /Status/ }).selectOption({ label: 'All statuses' });
  await page.getByRole('row', { name: /L-000001/ }).click();
  const panel = page.getByRole('dialog', { name: 'L-000001 · Smile Lab' });
  await expect(panel).toContainText('Zirconia crown #16');
  await expect(panel.getByText('Cost')).toHaveCount(0);
  await expect(panel).not.toContainText('$');
  await panel.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('tab', { name: 'Labs' }).click();
  await expect(page.getByText('Outstanding')).toHaveCount(0);
  // The lab's page: its price list without prices, no statement, nothing to edit.
  await page.getByRole('row', { name: /Smile Lab/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Smile Lab' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Statement' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Zirconia crown/ })).not.toContainText('$');
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveCount(0);
});
