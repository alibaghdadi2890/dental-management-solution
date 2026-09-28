import { expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** Unique per run so the flow can be repeated against the same database. */
const run = Date.now().toString(36);
const clinic = { name: `Patients Clinic ${run}`, slug: `patients-clinic-${run}` };
const owner = { email: `patients-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
const rana = { name: 'Rana Haddad', phone: '03 123 456', email: `rana-${run}@e2e.test` };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('the owner registers a patient with an opening balance, completes the record and finds it again', async ({
  page,
}) => {
  // The platform admin provisions a clinic (Lebanon and USD by default).
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(clinic.name);
  await expect(panel.getByLabel(/^Slug/)).toHaveValue(clinic.slug);
  await expect(panel.getByLabel('Country')).toHaveValue('LB');
  await expect(panel.getByLabel('Currency')).toHaveValue('USD');
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Patients Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await expect(panel.getByLabel('Practitioner type')).toHaveValue('dentist');
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The owner signs in with the temporary password and chooses their own.
  await signIn(page, owner.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(owner.password);
  await page.getByLabel('Confirm new password').fill(owner.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await expect(page.getByText('No patients yet')).toBeVisible();

  // Header "New patient": name, phone, email and an opening balance.
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  const form = page.getByRole('complementary', { name: 'Register a patient' });
  await form.getByRole('textbox', { name: /^Full name/ }).fill(rana.name);
  await form.getByRole('textbox', { name: /^Phone/ }).fill(rana.phone);
  await form.getByRole('textbox', { name: 'Email' }).fill(rana.email);
  // The owner is a dentist from provisioning, so the new clinic has a primary dentist to pick.
  await form.getByRole('combobox', { name: 'Primary dentist' }).selectOption('Dr. Patients Owner');
  await form.getByRole('textbox', { name: /^Opening balance/ }).fill('250');
  await form.getByRole('button', { name: 'Create patient' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Patient created' })).toBeVisible();
  await expect(form).toBeHidden();

  // The list shows the balance, and so does the "Owes balance" view.
  const table = page.getByRole('table', { name: 'Patients' });
  const row = table.getByRole('row').filter({ hasText: rana.name });
  await expect(row).toContainText('$250');
  await page.getByRole('tab', { name: /^Owes balance/ }).click();
  await expect(page.getByRole('tab', { name: /^Owes balance/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(row).toContainText('$250');

  // The owner (audit:read) sees the activity timeline in the quick view.
  await row.getByRole('button', { name: `Actions for ${rana.name}` }).click();
  await page.getByRole('menuitem', { name: 'Quick view' }).click();
  const quickView = page.getByRole('complementary', { name: rana.name });
  const activity = quickView.getByRole('region', { name: 'Activity' });
  await expect(activity).toBeVisible();
  await expect(activity).toContainText('Patient registered');
  await quickView.getByRole('button', { name: 'Close' }).click();
  await expect(quickView).toBeHidden();

  // The record: the Balance card totals the opening balance.
  await row.click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
  const recordPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1, name: rana.name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Balance' })).toContainText(
    /Total outstanding\s*\$250/,
  );

  // Patient information: adding the address completes the profile.
  await page.getByRole('tab', { name: 'Patient information' }).click();
  const information = page.getByRole('region', { name: 'Patient information' });
  await expect(information.getByText('Partly complete')).toBeVisible();
  await information.getByRole('textbox', { name: 'Address' }).fill('12 Hamra St, Beirut');
  await expect(information.getByRole('status')).toHaveText('Unsaved changes');
  await information.getByRole('button', { name: 'Save changes' }).click();
  await expect(information.getByRole('status')).toHaveText('✓Saved just now');
  await expect(information.getByText('Complete', { exact: true })).toBeVisible();
  await expect(information.getByText('Partly complete')).toBeHidden();

  // Ctrl+K from anywhere finds her by part of her phone number; Enter opens the record.
  await page.getByRole('link', { name: 'Patients' }).click();
  await expect(page).toHaveURL(/\/patients(\?.*)?$/);
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('combobox', {
    name: 'Search patients by name, phone or patient ID',
  });
  await expect(palette).toBeFocused();
  await palette.fill('3123');
  await expect(page.getByRole('option', { name: new RegExp(rana.name) })).toBeVisible();
  await palette.press('Enter');
  await expect(page).toHaveURL((url) => url.pathname === recordPath);
  await expect(page.getByRole('heading', { level: 1, name: rana.name })).toBeVisible();
});
