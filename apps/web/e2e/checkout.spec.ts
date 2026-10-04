import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

interface Account {
  email: string;
  password: string;
}

/** The clinic this file works in, provisioned once per worker (see `visit.spec.ts`). */
let clinic: { owner: Account; frontDesk: Account };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A temporary password becomes the account's own at first sign-in (ADR-0012), in a browser
 * context of its own. */
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

/** The platform admin provisions a clinic whose owner is a dentist, and adds a front desk user. */
async function provisionClinic(browser: Browser) {
  const run = Date.now().toString(36);
  const name = `Checkout Clinic ${run}`;
  const owner = { email: `checkout-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const frontDesk = { email: `checkout-desk-${run}@e2e.test`, password: 'desk-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Checkout Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const ownerTemporary = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  await page.getByText(name).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).first().click();
  const userPanel = page.getByRole('complementary', { name: 'Add a staff member' });
  await userPanel.getByLabel('Full name').fill('Dana Desk');
  await userPanel.getByLabel('Email').fill(frontDesk.email);
  await userPanel.getByLabel('Practitioner type').selectOption('frontdesk');
  await userPanel.getByRole('checkbox', { name: 'Front desk' }).check();
  await userPanel.getByRole('checkbox', { name: 'Main St' }).check();
  await userPanel.getByRole('button', { name: 'Generate' }).click();
  const deskTemporary = await userPanel.getByLabel('Temporary password').inputValue();
  await userPanel.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'User created' })).toBeVisible();
  await page.close();

  await choosePassword(browser, owner, ownerTemporary, /\/patients$/);
  // The front desk collects and doesn't treat: its home is the Today board.
  await choosePassword(browser, frontDesk, deskTemporary, /\/today$/);
  return { owner, frontDesk };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  clinic = await provisionClinic(browser);
});

test('the dentist completes a visit; the front desk discounts it and takes the payment', async ({
  browser,
}) => {
  test.slow();
  let page = await browser.newPage();

  await test.step('the dentist records a $50 composite and leaves the payment', async () => {
    await signIn(page, clinic.owner.email, clinic.owner.password);
    await expect(page).toHaveURL(/\/patients$/);
    await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
    const form = page.getByRole('complementary', { name: 'Register a patient' });
    await form.getByRole('textbox', { name: /^Full name/ }).fill('Lina Checkout');
    await form.getByRole('textbox', { name: /^Phone/ }).fill('03 555 909');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(form).toBeHidden();
    const table = page.getByRole('table', { name: 'Patients' });
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await table.getByRole('row').filter({ hasText: 'Lina Checkout' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lina Checkout' })).toBeVisible();

    await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);

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
    await page
      .getByRole('dialog', { name: 'Complete visit' })
      .getByRole('button', { name: 'Complete visit' })
      .click();
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await expect(recorded).toContainText(/Outstanding for this visit\s*\$50/);
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Checkout · 1' }),
    ).toBeVisible();
    await page.close();
  });

  await test.step('the front desk lands on Today and opens the checkout', async () => {
    page = await browser.newPage();
    await signIn(page, clinic.frontDesk.email, clinic.frontDesk.password);
    await expect(page).toHaveURL(/\/today$/);
    const waiting = page.getByRole('region', { name: 'Ready for checkout · 1' });
    await expect(waiting).toContainText('Lina Checkout');
    await expect(waiting).toContainText('$50');
    await waiting.getByRole('button', { name: 'Check out Lina Checkout' }).click();
    await expect(page.getByRole('dialog', { name: 'Checkout · Lina Checkout' })).toBeVisible();
  });

  await test.step('takes $10 off: the visit owes $40 and is still completed', async () => {
    const checkout = page.getByRole('dialog', { name: 'Checkout · Lina Checkout' });
    await checkout.getByRole('button', { name: 'Edit the visit discount' }).click();
    await checkout.getByRole('radio', { name: 'Amount' }).click();
    await checkout.getByRole('textbox', { name: 'Visit discount value' }).fill('10');
    await expect(checkout).toContainText(/New visit total\s*\$40/);
    await checkout.getByRole('button', { name: 'Apply' }).click();
    await expect(checkout.getByRole('button', { name: 'Apply' })).toBeHidden();
    await expect(checkout).toContainText(/Visit total\s*\$40/);
    await expect(checkout).toContainText(/Outstanding for this visit\s*\$40/);
  });

  await test.step('records the payment: the popup closes and the lane is empty', async () => {
    const checkout = page.getByRole('dialog', { name: 'Checkout · Lina Checkout' });
    // The payment is the dialog's next step, not a second popup, and the dialog keeps its size.
    const before = await checkout.boundingBox();
    await checkout.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(checkout.getByLabel('Amount taken now')).toHaveAttribute('placeholder', '40.00');
    expect(await checkout.boundingBox()).toEqual(before);
    await expect(checkout.getByText('Remaining after this payment')).toBeHidden();
    await checkout.getByLabel('Amount taken now').fill('40');
    await checkout.getByRole('button', { name: 'Record full payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: '$40 recorded' })).toBeVisible();
    // Recording the payment ends the checkout: no way back to the figures, nothing left open.
    await expect(checkout).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('No one is waiting to check out.')).toBeVisible();
  });
});
