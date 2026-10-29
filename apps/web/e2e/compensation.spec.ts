import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';
import { chooseTreatment, completeFromSummary, openAllView } from './start-visit';

interface Account {
  email: string;
  password: string;
}

/** The clinic this file works in: its owner, a dentist, and front desk. */
let clinic: { owner: Account; dentist: Account; frontDesk: Account };

/** Today and the first day of last month, as the clinic (Lebanon, day first) types them. */
const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const typed = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getFullYear())}`;
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

async function addUser(
  page: Page,
  user: { name: string; email: string; type: string; role: string },
): Promise<string> {
  await page.getByRole('button', { name: 'New user' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Add a staff member' });
  await panel.getByLabel('Full name').fill(user.name);
  await panel.getByLabel('Email').fill(user.email);
  await panel.getByLabel('Practitioner type').selectOption(user.type);
  await panel.getByRole('checkbox', { name: 'Main St' }).check();
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporary = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('tab', { name: 'Access' }).click();
  await panel.getByRole('checkbox', { name: user.role }).check();
  await panel.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'User created' })).toBeVisible();
  return temporary;
}

async function provisionClinic(browser: Browser) {
  const run = Date.now().toString(36);
  const name = `Pay Clinic ${run}`;
  const owner = { email: `comp-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const dentist = { email: `comp-dentist-${run}@e2e.test`, password: 'dentist-own-password-1' };
  const frontDesk = { email: `comp-desk-${run}@e2e.test`, password: 'desk-own-password-1' };
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
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  await page.getByText(name).click();
  await page.getByRole('link', { name: 'Users' }).click();
  const dentistTemporary = await addUser(page, {
    name: 'Dr. Dina Dent',
    email: dentist.email,
    type: 'dentist',
    role: 'Dentist',
  });
  const deskTemporary = await addUser(page, {
    name: 'Dana Desk',
    email: frontDesk.email,
    type: 'frontdesk',
    role: 'Front desk',
  });
  await page.close();

  await choosePassword(browser, owner, ownerTemporary, /\/patients$/);
  await choosePassword(browser, dentist, dentistTemporary, /\/patients$/);
  await choosePassword(browser, frontDesk, deskTemporary, /\/today$/);
  return { owner, dentist, frontDesk };
}

// The dentist's test reads what the owner's test set up, in the same clinic.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  clinic = await provisionClinic(browser);
});

test('the owner pays a dentist 40 % of collections: agreement, visit, payment, statement, payout, close', async ({
  browser,
}) => {
  test.slow();
  let page = await browser.newPage();

  await test.step('the owner sets up the agreement on the dentist’s Compensation tab', async () => {
    await signIn(page, clinic.owner.email, clinic.owner.password);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Staff' })
      .click();
    await page.getByRole('button', { name: 'Actions for Dr. Dina Dent' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const panel = page.getByRole('complementary', { name: 'Dr. Dina Dent' });
    // The panel has room for its three tabs (it was once squeezed to half its width).
    await expect(panel.getByRole('tab', { name: 'Compensation' })).toBeInViewport({ ratio: 1 });
    await panel.getByRole('tab', { name: 'Compensation' }).click();
    await panel.getByRole('button', { name: 'New agreement' }).click();
    await panel.getByRole('textbox', { name: 'Percent' }).fill('40');
    await panel.getByLabel('Effective from').fill(typed(lastMonth));
    await panel.getByRole('button', { name: 'Save agreement' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Agreement saved' })).toBeVisible();
    await expect(panel).toContainText('40 % of collected amounts');
    await page.close();
  });

  await test.step('the dentist completes a visit and front desk takes the payment', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.dentist.email, clinic.dentist.password);
    await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
    const form = page.getByRole('complementary', { name: 'Register a patient' });
    await form.getByRole('textbox', { name: /^Full name/ }).fill('Cora Collect');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(form).toBeHidden();
    const table = page.getByRole('table', { name: 'Patients' });
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await table.getByRole('row').filter({ hasText: 'Cora Collect' }).click();
    await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await chooseTreatment(popover);
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await openAllView(page);
    await page
      .getByRole('region', { name: 'Dental chart' })
      .getByRole('button', { name: /^#26 · / })
      .click();
    await page
      .getByRole('complementary', { name: 'Selected tooth' })
      .getByRole('button', { name: 'Add completed service', exact: true })
      .click();
    const drawer = page.getByRole('dialog', { name: 'Add completed service' });
    await drawer.getByRole('searchbox').fill('Composite');
    await drawer
      .getByRole('button')
      .filter({ has: page.getByText('Composite', { exact: true }) })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Composite added' })).toBeVisible();
    await page.getByRole('button', { name: 'Review & complete' }).click();
    await completeFromSummary(page);
    await page
      .getByRole('dialog', { name: 'Visit recorded' })
      .getByRole('button', { name: 'Done' })
      .click();
    await page.close();

    page = await browser.newPage();
    await signIn(page, clinic.frontDesk.email, clinic.frontDesk.password);
    const waiting = page.getByRole('region', { name: 'Ready for checkout · 1' });
    await waiting.getByRole('button', { name: 'Check out Cora Collect' }).click();
    const checkout = page.getByRole('dialog', { name: 'Checkout · Cora Collect' });
    await checkout.getByRole('button', { name: 'Record payment' }).click();
    await checkout.getByLabel('Amount taken now').fill('50');
    await checkout.getByRole('button', { name: 'Record full payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: '$50 recorded' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Compensation' })).toHaveCount(0);
    await page.close();
  });

  await test.step('the owner reads the statement and records a payout', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.owner.email, clinic.owner.password);
    await page.getByRole('link', { name: 'Compensation' }).click();
    const report = page.getByRole('table', { name: 'Compensation' });
    const row = report.getByRole('row').filter({ hasText: 'Dr. Dina Dent' });
    await expect(row).toContainText('$20');
    await expect(row).toContainText('Provisional');
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dr. Dina Dent' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Cora Collect');
    await page.getByRole('button', { name: 'Record payout' }).click();
    const panel = page.getByRole('dialog', { name: 'Record payout' });
    await panel.getByLabel('Amount').fill('5');
    await panel.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payout recorded' })).toBeVisible();
    await expect(page.locator('section').filter({ hasText: 'Closing balance' })).toContainText(
      '$15',
    );
  });

  await test.step('the owner closes last month, which then shows closed', async () => {
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText(monthName(lastMonth)).first()).toBeVisible();
    await page.getByRole('button', { name: 'Close month' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close month' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Month closed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
    await page.close();
  });
});

test('the dentist reads their own statement, provisional while the month is open', async ({
  browser,
}) => {
  test.slow();
  const page = await browser.newPage();
  await signIn(page, clinic.dentist.email, clinic.dentist.password);
  const sidebar = page.getByRole('complementary').first();
  await expect(sidebar.getByRole('link', { name: 'Compensation' })).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'My statement' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My statement' })).toBeVisible();
  await expect(page.getByText(/Provisional — figures may change/)).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Cora Collect');
  await expect(page.getByRole('main')).not.toContainText('Balance owed to dentists');
  await page.close();
});
