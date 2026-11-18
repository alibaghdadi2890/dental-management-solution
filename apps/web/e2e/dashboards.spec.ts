import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** Feature 19: the owner's dashboards, a drill-down and Back, and a line of Needs attention. */
interface Account {
  email: string;
  password: string;
}

let owner: Account;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function provisionClinic(browser: Browser): Promise<Account> {
  const run = Date.now().toString(36);
  const account = { email: `dash-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(`Dash Clinic ${run}`);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Olga Owner');
  await panel.getByLabel('Email').fill(account.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporary = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  // The tenants list reloads every dev clinic first: slow on a busy dev database.
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible({
    timeout: 30_000,
  });
  await page.close();

  const first = await browser.newPage();
  await signIn(first, account.email, temporary);
  await first.getByLabel(/^New password/).fill(account.password);
  await first.getByLabel('Confirm new password').fill(account.password);
  await first.getByRole('button', { name: 'Save and continue' }).click();
  await expect(first).toHaveURL(/\/patients$/);
  await first.close();
  return account;
}

/** An advance of 100 paid today, and a phone booking's quick patient (a registration to finish). */
async function seed(page: Page) {
  const key = () => crypto.randomUUID();
  const created = await page.request.post('/api/v1/patients', {
    headers: { 'Idempotency-Key': key() },
    data: { fullName: 'Dana Dashboard', phone: '+96170123456' },
  });
  expect(created.status()).toBe(201);
  const patient = (await created.json()) as { id: string };
  const session = (await (await page.request.get('/api/v1/session')).json()) as {
    tenant: { timeZone: string };
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: session.tenant.timeZone }).format(
    new Date(),
  );
  const paid = await page.request.post('/api/v1/billing/payments', {
    headers: { 'Idempotency-Key': key() },
    // Nothing is owed yet: an advance, kept as credit (ADR-0051).
    data: {
      patientId: patient.id,
      amount: '100',
      method: 'cash',
      paidAt: today,
      advance: 'credit',
    },
  });
  expect(paid.status()).toBe(201);
  const quick = await page.request.post('/api/v1/patients', {
    headers: { 'Idempotency-Key': key() },
    data: { fullName: 'Quinn Quick', phone: '+96170999888', registrationIncomplete: true },
  });
  expect(quick.status()).toBe(201);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  owner = await provisionClinic(browser);
});

test('the owner reads the dashboards, opens Collected and comes back, then an attention line', async ({
  page,
}) => {
  test.slow();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/patients$/);
  await seed(page);

  await test.step('Financial: Collected opens Payments for the period, with its total', async () => {
    // The Patients screen has settled before the sidebar is used.
    await expect(page.getByRole('heading', { name: 'Patients', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const collected = page.getByRole('link', { name: /Collected/ }).first();
    await expect(collected).toContainText('$100');
    await collected.click();
    await expect(page).toHaveURL(/\/payments\?.*from=/);
    await expect(page.getByText('Total $100')).toBeVisible();
  });

  await test.step('Back returns to the dashboard as it was', async () => {
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('link', { name: /Collected/ }).first()).toContainText('$100');
  });

  await test.step('Operational: a line of Needs attention opens its list', async () => {
    await page.getByRole('tab', { name: 'Operational' }).click();
    await expect(page).toHaveURL(/tab=operational/);
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await attention.getByRole('link', { name: /Registrations incomplete/ }).click();
    await expect(page).toHaveURL(/\/patients\?.*cohort=incomplete/);
    await expect(page.getByText('Quinn Quick')).toBeVisible();
    await expect(page.getByText('Dana Dashboard')).toHaveCount(0);
  });
});
