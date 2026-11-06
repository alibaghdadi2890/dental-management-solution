import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

interface Account {
  email: string;
  password: string;
}

/** The clinic this file works in: its owner and front desk. */
let clinic: { owner: Account; frontDesk: Account };

const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const monthName = (date: Date) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function choosePassword(
  browser: Browser,
  account: Account,
  temporary: string,
  landing: RegExp,
) {
  const page = await browser.newPage();
  await signIn(page, account.email, temporary);
  await page.getByLabel(/^New password/).fill(account.password);
  await page.getByLabel('Confirm new password').fill(account.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(landing);
  await page.close();
}

async function provisionClinic(browser: Browser) {
  const run = Date.now().toString(36);
  const name = `Spend Clinic ${run}`;
  const owner = { email: `spend-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const frontDesk = { email: `spend-desk-${run}@e2e.test`, password: 'desk-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Olga Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const ownerTemporary = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  // The tenants list reloads every dev clinic first: slow on a busy dev database.
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByText(name).click();
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).first().click();
  const user = page.getByRole('complementary', { name: 'Add a staff member' });
  await user.getByLabel('Full name').fill('Dana Desk');
  await user.getByLabel('Email').fill(frontDesk.email);
  await user.getByLabel('Practitioner type').selectOption('frontdesk');
  await user.getByRole('checkbox', { name: 'Main St' }).check();
  await user.getByRole('button', { name: 'Generate' }).click();
  const deskTemporary = await user.getByLabel('Temporary password').inputValue();
  await user.getByRole('tab', { name: 'Access' }).click();
  await user.getByRole('checkbox', { name: 'Front desk' }).check();
  await user.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'User created' })).toBeVisible();
  await page.close();

  await choosePassword(browser, owner, ownerTemporary, /\/patients$/);
  await choosePassword(browser, frontDesk, deskTemporary, /\/today$/);
  return { owner, frontDesk };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  clinic = await provisionClinic(browser);
});

test('a fixed expense waits, is confirmed at its real amount, and shows on Today and in the history', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.owner.email, clinic.owner.password);
  await expect(page).toHaveURL(/\/patients$/);

  await test.step('the owner adds Electricity from last month', async () => {
    await page.getByRole('link', { name: 'Expenses' }).click();
    await page.getByRole('tab', { name: 'Fixed expenses' }).click();
    await page.getByRole('button', { name: 'Add fixed expense' }).click();
    const panel = page.getByRole('dialog', { name: 'Add fixed expense' });
    await panel.getByLabel('Name').fill('Electricity');
    await panel.getByLabel('Category').selectOption({ label: 'Electricity' });
    await panel.getByLabel('Usual amount').fill('120');
    await panel.getByRole('radio', { name: 'Bank transfer' }).click();
    await panel.getByLabel('First month').selectOption({ label: monthName(lastMonth) });
    await panel.getByRole('button', { name: 'Add fixed expense' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fixed expense added' })).toBeVisible();
  });

  await test.step('last month and this month wait; last month is confirmed at 138.50', async () => {
    await page.getByRole('tab', { name: 'History' }).click();
    const waiting = page.getByRole('listitem').filter({ hasText: monthName(lastMonth) });
    await expect(page.getByRole('heading', { name: 'Waiting for confirmation · 2' })).toBeVisible();
    await waiting.getByRole('button', { name: 'Confirm' }).click();
    const panel = page.getByRole('dialog', { name: /Confirm Electricity/ });
    await panel.getByLabel('Amount').fill('138.50');
    await panel.getByRole('button', { name: 'Confirm expense' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Expense confirmed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting for confirmation · 1' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Electricity.*\$138\.50/ })).toBeVisible();
  });

  await test.step('Today shows the month with what still waits, and See all opens the history', async () => {
    await page.getByRole('link', { name: 'Today' }).click();
    const card = page.getByRole('region', { name: "This month's expenses" });
    await expect(card.getByText('$138.50').first()).toBeVisible();
    await expect(card.getByText('Waiting for confirmation · 1')).toBeVisible();
    await card.getByRole('link', { name: 'See all' }).click();
    await expect(page).toHaveURL(/\/expenses/);
    await expect(page.getByText('Total · 1 expense')).toBeVisible();
  });
});

test('an employee is paid through payroll: salary change, confirm, the Salaries row, void', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.owner.email, clinic.owner.password);
  await expect(page).toHaveURL(/\/patients$/);

  await test.step('the owner adds Rima at 800, then raises her to 900', async () => {
    await page.getByRole('link', { name: 'Payroll' }).click();
    await page.getByRole('tab', { name: 'Employees' }).click();
    await page.getByRole('button', { name: 'Add employee' }).click();
    const panel = page.getByRole('dialog', { name: 'Add employee' });
    await panel.getByLabel('Full name').fill('Rima Haddad');
    await panel.getByLabel('Job title').fill('Receptionist');
    await panel.getByLabel('Monthly salary').fill('800');
    await panel.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Employee added' })).toBeVisible();

    await page.getByRole('row', { name: /Rima Haddad/ }).click();
    const rima = page.getByRole('dialog', { name: 'Rima Haddad' });
    await rima.getByRole('button', { name: 'Change salary' }).click();
    await rima.getByLabel('New monthly salary').fill('900');
    await rima.getByRole('button', { name: 'Save new salary' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Salary changed' })).toBeVisible();
    await expect(rima.getByText(/\$900 from/)).toBeVisible();
    await expect(rima.getByText(/\$800 from/)).toBeVisible();
    await rima.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('this month’s run pays her 900 by bank transfer', async () => {
    await page.getByRole('tab', { name: 'Monthly run' }).click();
    const line = page.getByRole('row', { name: /Rima Haddad/ });
    await expect(line.getByText('$900').first()).toBeVisible();
    await line.getByRole('button', { name: 'Confirm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm 1 salary' });
    await dialog.getByRole('radio', { name: 'Bank transfer' }).click();
    await dialog.getByRole('button', { name: 'Confirm 1 salary' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 salary paid' })).toBeVisible();
    await expect(line.getByText('Paid', { exact: true })).toBeVisible();
  });

  await test.step('the payment is a Salaries row in Expenses, never on the Today card', async () => {
    await page.getByRole('link', { name: 'Expenses' }).click();
    await expect(
      page.getByRole('row', { name: /Salaries.*Rima Haddad.*\$900.*Payroll/ }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Today' }).click();
    const card = page.getByRole('region', { name: "This month's expenses" });
    await expect(card.getByText('Rima Haddad')).toHaveCount(0);
  });

  await test.step('voiding the payment puts the line back to pending', async () => {
    await page.getByRole('link', { name: 'Payroll' }).click();
    const line = page.getByRole('row', { name: /Rima Haddad/ });
    await line.getByRole('button', { name: 'Void payment' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('textbox').fill('Wrong account');
    await confirm.getByRole('button', { name: 'Void payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment voided' })).toBeVisible();
    await expect(line.getByText('Pending', { exact: true })).toBeVisible();
    await expect(line.getByText(/Voided payment of \$900/)).toBeVisible();
  });
});

test('the front desk sees neither expenses nor payroll', async ({ page }) => {
  await signIn(page, clinic.frontDesk.email, clinic.frontDesk.password);
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('link', { name: 'Expenses' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Payroll' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: "This month's expenses" })).toHaveCount(0);
  await page.goto('/payroll');
  await expect(page.getByText('No access to payroll')).toBeVisible();
});
