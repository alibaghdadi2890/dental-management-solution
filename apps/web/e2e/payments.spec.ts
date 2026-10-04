import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** The clinic this file works in, provisioned once per worker (see `visit.spec.ts`). */
let owner: { email: string; password: string };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The platform admin provisions a clinic; its owner (a dentist, so they may refund) sets a
 * password. */
async function provisionClinic(browser: Browser) {
  const run = Date.now().toString(36);
  const name = `Payments Clinic ${run}`;
  const account = { email: `pay-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Pay Owner');
  await panel.getByLabel('Email').fill(account.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, account.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(account.password);
  await page.getByLabel('Confirm new password').fill(account.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await page.close();
  return account;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  owner = await provisionClinic(browser);
});

test('a partial payment, its receipt, a refund, and the balance restored', async ({ page }) => {
  test.slow();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/patients$/);

  await test.step('a patient carried over owing $200', async () => {
    await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
    const form = page.getByRole('complementary', { name: 'Register a patient' });
    await form.getByRole('textbox', { name: /^Full name/ }).fill('Nadia Saliba');
    await form.getByRole('textbox', { name: /^Phone/ }).fill('03 555 777');
    await form.getByRole('textbox', { name: /^Opening balance/ }).fill('200');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(form).toBeHidden();
    const table = page.getByRole('table', { name: 'Patients' });
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await table.getByRole('row').filter({ hasText: 'Nadia Saliba' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nadia Saliba' })).toBeVisible();
    await page.getByRole('tab', { name: 'Balance & payments' }).click();
  });

  await test.step('records a partial payment of $80', async () => {
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Record payment' });
    await expect(dialog.getByLabel('Amount taken now')).toHaveAttribute('placeholder', '200.00');
    await dialog.getByLabel('Amount taken now').fill('80');
    await dialog.getByRole('button', { name: 'Card' }).click();
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: '$80 recorded' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Payment history' })).toContainText('$120');
  });

  await test.step('opens its receipt', async () => {
    const opened = page.context().waitForEvent('page');
    await page
      .getByRole('table', { name: 'Payment history' })
      .getByRole('button', { name: 'Receipt' })
      .click();
    const receipt = await opened;
    await expect(receipt.getByRole('heading', { level: 1, name: 'Receipt' })).toBeVisible();
    await expect(receipt.getByText('RCT-000001')).toBeVisible();
    await expect(receipt.getByText('Total received')).toBeVisible();
    await receipt.close();
  });

  await test.step('refunds it from Payments', async () => {
    await page.getByRole('link', { name: 'Payments' }).click();
    const row = page
      .getByRole('table', { name: 'Transactions' })
      .getByRole('row')
      .filter({ hasText: 'Nadia Saliba' });
    await row.getByRole('button', { name: 'Refund' }).click();
    const dialog = page.getByRole('dialog', { name: 'Refund RCT-000001' });
    await expect(dialog.getByLabel('Amount to refund')).toHaveValue('80.00');
    await dialog.getByLabel(/^Reason/).fill('Paid by the insurer instead');
    await dialog.getByRole('button', { name: 'Refund' }).click();
    await expect(page.getByRole('status').filter({ hasText: '$80 refunded' })).toBeVisible();
  });

  await test.step('the balance is $200 again', async () => {
    await page
      .getByRole('table', { name: 'Transactions' })
      .getByRole('link', { name: 'Nadia Saliba' })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nadia Saliba' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('$200');
    await expect(page.getByRole('table', { name: 'Payment history' })).toContainText(
      'Refunded $80',
    );
  });
});
