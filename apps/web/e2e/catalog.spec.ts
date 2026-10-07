import { expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** Unique per run so the flow can be repeated against the same database. */
const run = Date.now().toString(36);
const clinic = { name: `Catalog Clinic ${run}`, slug: `catalog-clinic-${run}` };
const owner = { email: `catalog-owner-${run}@e2e.test`, password: 'owner-own-password-1' };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a new clinic starts with the default catalog, which its owner edits', async ({ page }) => {
  // The platform admin provisions a clinic; the default catalog comes with it.
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(clinic.name);
  await expect(panel.getByLabel(/^Slug/)).toHaveValue(clinic.slug);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Catalog Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  await page.getByText(clinic.name).click();
  await expect(page.getByRole('heading', { level: 1, name: clinic.name })).toBeVisible();
  await expect(page.getByText('12 active of 13')).toBeVisible();
  await expect(page.getByText('13 active of 14')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Seed default catalog' })).toBeHidden();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The owner signs in and opens the catalog.
  await signIn(page, owner.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(owner.password);
  await page.getByLabel('Confirm new password').fill(owner.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('link', { name: 'Catalog' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' }).first()).toHaveValue('Extraction');

  // Add a service in a new category and save.
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.getByRole('textbox', { name: 'Code' }).first().fill('impl');
  await expect(page.getByRole('textbox', { name: 'Code' }).first()).toHaveValue('IMPL');
  await page.getByRole('textbox', { name: 'Name' }).first().fill('Implant consult');
  await page.getByRole('combobox', { name: 'Category' }).first().fill('Implants');
  await page.getByRole('textbox', { name: 'Price' }).first().fill('120');
  await expect(page.getByRole('region', { name: '1 unsaved change' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved 1 catalog change' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: /unsaved/ })).toBeHidden();

  // Filter by the new category: only the new service.
  await page.getByRole('button', { name: 'Implants' }).click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveCount(1);
  await expect(name).toHaveValue('Implant consult');

  // Mark it inactive and save.
  await page.getByRole('switch', { name: 'Active' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('region', { name: /unsaved/ })).toBeHidden();
  await expect(page.getByRole('switch', { name: 'Active' })).not.toBeChecked();

  // Hidden without "Show inactive", struck out with it.
  await page.getByRole('checkbox', { name: 'Show inactive' }).uncheck();
  await expect(name).toHaveCount(0);
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show inactive' }).check();
  await expect(name).toHaveValue('Implant consult');
  await expect(name).toHaveCSS('text-decoration-line', 'line-through');
});
