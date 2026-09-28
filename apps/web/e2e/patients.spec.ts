import { expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** Unique per run so the flow can be repeated against the same database. */
const run = Date.now().toString(36);
const clinic = { name: `Patients Clinic ${run}`, slug: `patients-clinic-${run}` };
const owner = { email: `patients-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
/** Two children and their mother. A date of birth mid-March seven years back is a minor's
 * whatever today is, typed in Lebanon's day/month order. */
const childDob = `15/03/${String(new Date().getFullYear() - 7)}`;
const lina = { name: 'Lina Haddad', email: `lina-${run}@e2e.test` };
const sami = { name: 'Sami Haddad' };
const maria = { name: 'Maria Haddad', phone: '03 123 456' };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The platform admin provisions a clinic (Lebanon and USD by default) whose owner is a dentist;
 * the owner signs in with the temporary password and chooses their own. */
async function openNewClinic(page: Page) {
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

  await signIn(page, owner.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(owner.password);
  await page.getByLabel('Confirm new password').fill(owner.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await expect(page.getByText('No patients yet')).toBeVisible();
}

/** Header "New patient" → the create panel. */
async function newPatient(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  return page.getByRole('complementary', { name: 'Register a patient' });
}

/** The list while its rows are the current query's (a row of the previous one is inert). */
async function settledList(page: Page) {
  const table = page.getByRole('table', { name: 'Patients' });
  await expect(table).toHaveAttribute('aria-busy', 'false');
  return table;
}

async function openRecordFromList(page: Page, name: string) {
  await page.getByRole('link', { name: 'Patients' }).click();
  const table = await settledList(page);
  await table.getByRole('row').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('the owner registers a child with a new guardian and an opening balance, completes the record, and the family grows', async ({
  page,
}) => {
  test.slow();
  await openNewClinic(page);

  await test.step('a minor with a new guardian and an opening balance', async () => {
    const form = await newPatient(page);
    await form.getByRole('textbox', { name: /^Full name/ }).fill(lina.name);
    await form.getByRole('textbox', { name: /^Date of birth/ }).fill(childDob);
    // The date of birth makes her a minor: the Guardian block, still without a guardian.
    const guardian = form.getByRole('region', { name: 'Guardian' });
    await expect(guardian.getByText('No guardian recorded')).toBeVisible();
    await expect(guardian.getByRole('checkbox', { name: 'Also billing contact' })).toBeChecked();
    await expect(guardian.getByRole('checkbox', { name: 'Also emergency contact' })).toBeChecked();
    await guardian.getByRole('button', { name: 'Add new contact' }).click();
    const newContact = guardian.getByRole('group', { name: 'New contact' });
    await newContact.getByRole('textbox', { name: /^Name/ }).fill(maria.name);
    await newContact.getByRole('textbox', { name: /^Phone/ }).fill(maria.phone);
    await expect(newContact.getByRole('combobox', { name: 'Relationship' })).toHaveValue('parent');
    await newContact.getByRole('button', { name: 'Add contact' }).click();
    const pending = guardian.getByRole('list', { name: 'Contacts' });
    await expect(pending).toContainText(maria.name);
    await expect(pending).toContainText('Guardian');
    await expect(pending).toContainText('Billing');
    await expect(pending).toContainText('Emergency');
    await expect(guardian.getByText('No guardian recorded')).toBeHidden();

    await form
      .getByRole('combobox', { name: 'Primary dentist' })
      .selectOption('Dr. Patients Owner');
    await form.getByRole('textbox', { name: /^Opening balance/ }).fill('250');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Patient created' })).toBeVisible();
    await expect(form).toBeHidden();
  });

  const table = page.getByRole('table', { name: 'Patients' });
  const linaRow = table.getByRole('row').filter({ hasText: lina.name });

  await test.step('the list shows the guardian’s phone and the balance', async () => {
    await expect(linaRow).toContainText(maria.phone);
    await expect(linaRow).toContainText('via Maria');
    await expect(linaRow).toContainText('$250');
    await page.getByRole('tab', { name: /^Owes balance/ }).click();
    await expect(page.getByRole('tab', { name: /^Owes balance/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await settledList(page);
    await expect(linaRow).toContainText('$250');
  });

  const recordPath = await test.step('the record: guardian chip and completeness', async () => {
    await linaRow.click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
    const path = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: lina.name })).toBeVisible();
    await expect(page.getByText(`Guardian · ${maria.name} · ${maria.phone}`)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Balance' })).toContainText(
      /Total outstanding\s*\$250/,
    );

    // Patient information: with the guardian, email and address complete the profile.
    await page.getByRole('tab', { name: 'Patient information' }).click();
    const information = page.getByRole('region', { name: 'Patient information' });
    await expect(information.getByText('Partly complete')).toBeVisible();
    await information.getByRole('textbox', { name: 'Email' }).fill(lina.email);
    await information.getByRole('textbox', { name: 'Address' }).fill('12 Hamra St, Beirut');
    await expect(information.getByRole('status')).toHaveText('Unsaved changes');
    await information.getByRole('button', { name: 'Save changes' }).click();
    await expect(information.getByRole('status')).toHaveText('✓Saved just now');
    await expect(information.getByText('Complete', { exact: true })).toBeVisible();
    await expect(information.getByText('Partly complete')).toBeHidden();
    return path;
  });

  await test.step('⌘K finds her by her guardian’s phone digits', async () => {
    await page.getByRole('link', { name: 'Patients' }).click();
    await expect(page).toHaveURL(/\/patients(\?.*)?$/);
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('combobox', {
      name: 'Search patients by name, phone or patient ID',
    });
    await expect(palette).toBeFocused();
    await palette.fill('3123');
    const option = page.getByRole('option', { name: new RegExp(lina.name) });
    await expect(option).toContainText(`via ${maria.name} · Parent`);
    await palette.press('Enter');
    await expect(page).toHaveURL((url) => url.pathname === recordPath);
    await expect(page.getByRole('heading', { level: 1, name: lina.name })).toBeVisible();
  });

  await test.step('her brother is registered with the same guardian, found by phone', async () => {
    await page.getByRole('link', { name: 'Patients' }).click();
    const form = await newPatient(page);
    await form.getByRole('textbox', { name: /^Full name/ }).fill(sami.name);
    await form.getByRole('textbox', { name: /^Date of birth/ }).fill(childDob);
    const guardian = form.getByRole('region', { name: 'Guardian' });
    await guardian.getByRole('combobox', { name: 'Search a guardian' }).fill('3123');
    await guardian.getByRole('option', { name: new RegExp(maria.name) }).click();
    const staged = guardian.getByRole('group', { name: `Adding ${maria.name}` });
    await expect(staged.getByRole('combobox', { name: 'Relationship' })).toHaveValue('parent');
    await staged.getByRole('button', { name: 'Add guardian' }).click();
    await expect(guardian.getByRole('list', { name: 'Contacts' })).toContainText(maria.name);
    await form.getByRole('button', { name: 'Create patient' }).click();
    // The previous registration's toast may still be up.
    await expect(
      page.getByRole('status').filter({ hasText: 'Patient created' }).last(),
    ).toBeVisible();
    await expect(form).toBeHidden();
    await page.getByRole('tab', { name: 'Active' }).click();
    await expect(page.getByRole('tab', { name: 'Active' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await settledList(page);
    await expect(table.getByRole('row').filter({ hasText: sami.name })).toContainText('via Maria');

    // Both children list her, one contact.
    for (const child of [sami.name, lina.name]) {
      await openRecordFromList(page, child);
      await page.getByRole('tab', { name: 'Patient information' }).click();
      const card = page.getByRole('region', { name: 'Contacts & family' });
      await expect(card.getByRole('list', { name: 'Contacts' })).toContainText(maria.name);
    }
  });

  await test.step('the mother becomes a patient herself', async () => {
    await page.getByRole('link', { name: 'Patients' }).click();
    const form = await newPatient(page);
    await form.getByRole('textbox', { name: /^Full name/ }).fill(maria.name);
    await form.getByRole('textbox', { name: /^Phone/ }).fill(maria.phone);
    await form
      .getByRole('status')
      .filter({ hasText: `Is this patient ${maria.name}?` })
      .getByRole('button', { name: 'Yes, same person' })
      .click();
    await expect(form.getByText(`Will link to ${maria.name}`)).toBeVisible();
    await form.getByRole('button', { name: 'Create patient' }).click();
    // The previous registration's toast may still be up.
    await expect(
      page.getByRole('status').filter({ hasText: 'Patient created' }).last(),
    ).toBeVisible();
    await expect(form).toBeHidden();

    // Her daughter's record now shows the guardian as a patient.
    await openRecordFromList(page, lina.name);
    await page.getByRole('tab', { name: 'Patient information' }).click();
    const card = page.getByRole('region', { name: 'Contacts & family' });
    await expect(card.getByRole('list', { name: 'Contacts' })).toContainText(/Patient P-\d{6}/);
  });
});
