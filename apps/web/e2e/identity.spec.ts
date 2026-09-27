import { expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** Unique per run so the flow can be repeated against the same database. */
const run = Date.now().toString(36);
const clinic = { name: `E2E Clinic ${run}`, slug: `e2e-clinic-${run}` };
const frontDesk = {
  name: 'Jamie Ortiz',
  email: `frontdesk-${run}@e2e.test`,
  password: 'my-own-password-1',
};

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('platform admin provisions a clinic and a user, who then signs in to the clinic', async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN.email, 'not-the-password');
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await expect(page.getByText('Platform admin').first()).toBeVisible();

  // New tenant panel: clinic, first branch, owner account.
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(clinic.name);
  await expect(panel.getByLabel(/^Slug/)).toHaveValue(clinic.slug);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. E2E Owner');
  await panel.getByLabel('Email').fill(`owner-${run}@e2e.test`);
  await panel.getByRole('button', { name: 'Generate' }).click();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  // Open it and add a room through the Catalog-style editor.
  await page.getByText(clinic.name).click();
  await expect(page.getByRole('heading', { level: 1, name: clinic.name })).toBeVisible();
  await page.getByRole('link', { name: 'Branches & rooms' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('textbox', { name: 'Code' }).fill('R1');
  await page.getByRole('textbox', { name: 'Name' }).fill('Room 1');
  await expect(page.getByRole('region', { name: '1 unsaved change' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  await expect(page.getByRole('region', { name: /unsaved/ })).toBeHidden();

  // Users tab: a front desk user with a generated temporary password.
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.getByText('Dr. E2E Owner')).toBeVisible();
  await page.getByRole('button', { name: 'New user' }).first().click();
  const userPanel = page.getByRole('complementary', { name: 'Add a staff member' });
  await userPanel.getByLabel('Full name').fill(frontDesk.name);
  await userPanel.getByLabel('Email').fill(frontDesk.email);
  await userPanel.getByLabel('Practitioner type').selectOption('frontdesk');
  await userPanel.getByRole('checkbox', { name: 'Front desk' }).check();
  await userPanel.getByRole('checkbox', { name: 'Main St' }).check();
  await userPanel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await userPanel.getByLabel('Temporary password').inputValue();
  await userPanel.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'User created' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: frontDesk.email })).toContainText(
    'Front desk',
  );

  // Manage in clinic: the normal shell with the amber banner, then back.
  await page.getByRole('button', { name: 'Manage in clinic' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await expect(page.getByText(`Managing ${clinic.name} as platform admin`)).toBeVisible();
  await expect(page.getByText('Clinic · Main St')).toBeVisible();
  await page.getByRole('link', { name: 'Exit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: clinic.name })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The new user signs in with the temporary password, chooses their own, lands in the clinic.
  await signIn(page, frontDesk.email, temporaryPassword);
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel(/^New password/).fill(frontDesk.password);
  await page.getByLabel('Confirm new password').fill(frontDesk.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Clinic · Main St')).toBeVisible();
  await expect(page.getByText(frontDesk.name)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catalog' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();
  await expect(page.getByText('Managing')).toBeHidden();
});
