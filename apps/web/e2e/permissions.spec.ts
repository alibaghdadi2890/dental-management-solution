import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';
import { chooseTreatment, openAllView } from './start-visit';

interface Account {
  email: string;
  password: string;
}

/** The clinic this file works in: its owner, a dentist who is not the owner, and front desk. */
let clinic: { name: string; owner: Account; dentist: Account; frontDesk: Account };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function choosePassword(
  browser: Browser,
  account: Account,
  temporaryPassword: string,
  landing: RegExp,
) {
  const page = await browser.newPage();
  await signIn(page, account.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(account.password);
  await page.getByLabel('Confirm new password').fill(account.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(landing);
  await page.close();
}

/** In the admin portal's Users tab: a staff member with one role, a temporary password back. */
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
  const name = `Access Clinic ${run}`;
  const owner = { email: `access-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const dentist = { email: `access-dentist-${run}@e2e.test`, password: 'dentist-own-password-1' };
  const frontDesk = { email: `access-desk-${run}@e2e.test`, password: 'desk-own-password-1' };
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
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
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
  return { name, owner, dentist, frontDesk };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  clinic = await provisionClinic(browser);
});

test('a dentist completes a visit and hands it to front desk; the owner grants him balances', async ({
  browser,
}) => {
  test.slow();
  let page = await browser.newPage();

  await test.step('the dentist sees no money, completes the visit, and hands it off', async () => {
    await signIn(page, clinic.dentist.email, clinic.dentist.password);
    await expect(page).toHaveURL(/\/patients$/);
    const sidebar = page.getByRole('complementary').first();
    await expect(sidebar.getByRole('link', { name: 'Visits' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Payments' })).toHaveCount(0);

    await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
    const form = page.getByRole('complementary', { name: 'Register a patient' });
    await form.getByRole('textbox', { name: /^Full name/ }).fill('Hana Handoff');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(form).toBeHidden();
    const table = page.getByRole('table', { name: 'Patients' });
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await table.getByRole('row').filter({ hasText: 'Hana Handoff' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hana Handoff' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Balance & payments' })).toHaveCount(0);

    await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await chooseTreatment(popover);
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
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
    // His own visit's prices show; the discount is not his to give.
    await expect(page.getByText('Ask the owner').first()).toBeVisible();

    await page.getByRole('button', { name: 'Review & complete' }).click();
    await page
      .getByRole('dialog', { name: 'Complete visit' })
      .getByRole('button', { name: 'Complete visit' })
      .click();
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await expect(recorded).toContainText('Handed to front desk for payment');
    await expect(recorded).toContainText(/Outstanding for this visit\s*\$50/);
    await expect(recorded.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await expect(recorded).not.toContainText('Total outstanding');
    await recorded.getByRole('button', { name: 'Done' }).click();
    await page.close();
  });

  await test.step('front desk finds it in the queue and takes the payment', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.frontDesk.email, clinic.frontDesk.password);
    await expect(page).toHaveURL(/\/today$/);
    const waiting = page.getByRole('region', { name: 'Ready for checkout · 1' });
    await expect(waiting).toContainText('Hana Handoff');
    await expect(waiting).toContainText('$50');
    await waiting.getByRole('button', { name: 'Check out Hana Handoff' }).click();
    const checkout = page.getByRole('dialog', { name: 'Checkout · Hana Handoff' });
    await expect(checkout.getByRole('button', { name: 'Edit the visit discount' })).toHaveCount(0);
    await checkout.getByRole('button', { name: 'Record payment' }).click();
    await checkout.getByLabel('Amount taken now').fill('50');
    await checkout.getByRole('button', { name: 'Record full payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: '$50 recorded' })).toBeVisible();
    await page.close();
  });

  await test.step('the owner grants the dentist patient balances, on the Access tab', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.owner.email, clinic.owner.password);
    await page.getByRole('link', { name: 'Settings' }).click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Staff' })
      .click();
    await page.getByRole('button', { name: 'Actions for Dr. Dina Dent' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const panel = page.getByRole('complementary', { name: 'Dr. Dina Dent' });
    // Beside the page, where the owner can see it (it once opened below the fold).
    await expect(panel).toBeInViewport();
    await panel.getByRole('tab', { name: 'Access' }).click();
    await expect(panel.getByRole('switch', { name: 'See own visits' })).toBeDisabled();
    await panel.getByRole('switch', { name: 'Record payments' }).click();
    // What it needs comes with it.
    await expect(
      panel.getByRole('switch', { name: 'See patient balances & payments' }),
    ).toBeChecked();
    await panel.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();

    // New role opens beside the roles too.
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Roles' })
      .click();
    await page.getByRole('button', { name: 'New role' }).click();
    const newRole = page.getByRole('complementary', { name: 'New role' });
    await expect(newRole).toBeInViewport();
    await newRole.getByRole('button', { name: 'Cancel' }).click();
    await expect(newRole).toBeHidden();
    await page.close();
  });

  await test.step('the dentist sees the patient’s balance on his next visit to the record', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.dentist.email, clinic.dentist.password);
    const table = page.getByRole('table', { name: 'Patients' });
    await table.getByRole('row').filter({ hasText: 'Hana Handoff' }).click();
    await expect(page.getByRole('tab', { name: 'Balance & payments' })).toBeVisible();
    await page.close();
  });
});

test('the platform admin sees the default roles and manages a clinic’s roles for it (ADR-0056)', async ({
  browser,
}) => {
  const page = await browser.newPage();
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);

  // The defaults are only looked at here: other suites' new clinics are created from them.
  await page.getByRole('link', { name: 'Default roles' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Default roles' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Dentist/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);

  // Every clinic's Activity (ADR-0057), narrowed to this one: the dentist's work is there.
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Activity across clinics' }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Clinic' }).selectOption({ label: clinic.name });
  await expect(
    page.getByRole('row').filter({ hasText: 'Registered patient Hana Handoff' }),
  ).toContainText(clinic.name);

  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.getByText(clinic.name).click();
  await page.getByRole('link', { name: 'Roles', exact: true }).click();
  await page.getByRole('button', { name: /^Assistant/ }).click();
  await page.getByRole('switch', { name: 'See patient balances & payments' }).click();
  await page
    .getByRole('region', { name: '1 unsaved change' })
    .getByRole('button', { name: 'Save changes' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Role saved' })).toBeVisible();
  await page.close();
});
