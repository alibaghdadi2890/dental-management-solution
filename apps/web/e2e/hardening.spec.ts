import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * Feature 7 (MVP hardening): tooth presence in a visit and at intake, a balance adjustment and
 * its statement, and the Activity screen. One clinic, provisioned once; each flow registers its
 * own patients.
 */
interface Clinic {
  owner: { email: string; password: string };
}

let clinic: Clinic;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The platform admin provisions a clinic (USD, the default catalog) whose owner is a dentist and
 * gives its branch a room; the owner then chooses their own password. */
async function provisionClinic(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const name = `Hardening Clinic ${run}`;
  const owner = { email: `hardening-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Hardening Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  await page.getByText(name).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('link', { name: 'Branches & rooms' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('textbox', { name: 'Code' }).first().fill('R1');
  await page.getByRole('textbox', { name: 'Name' }).first().fill('Room 1');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, owner.email, temporaryPassword);
  await page.getByLabel(/^New password/).fill(owner.password);
  await page.getByLabel('Confirm new password').fill(owner.password);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await page.close();
  return { owner };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  clinic = await provisionClinic(browser);
});

async function signInAsOwner(page: Page) {
  await signIn(page, clinic.owner.email, clinic.owner.password);
  await expect(page).toHaveURL(/\/patients$/);
}

/** Registers a patient from the list's header panel and opens their record. */
async function registerPatient(
  page: Page,
  patient: { name: string; phone: string; openingBalance?: string },
) {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  const form = page.getByRole('complementary', { name: 'Register a patient' });
  await form.getByRole('textbox', { name: /^Full name/ }).fill(patient.name);
  await form.getByRole('textbox', { name: /^Phone/ }).fill(patient.phone);
  if (patient.openingBalance) {
    await form.getByRole('textbox', { name: /^Opening balance/ }).fill(patient.openingBalance);
  }
  await form.getByRole('button', { name: 'Create patient' }).click();
  await expect(form).toBeHidden();
  const table = page.getByRole('table', { name: 'Patients' });
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await table.getByRole('row').filter({ hasText: patient.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: patient.name })).toBeVisible();
}

const chartCard = (page: Page) => page.getByRole('region', { name: 'Dental chart' });

/** A chart tooth by its notation label: its accessible name is its hover title, `#16 · …`. */
const tooth = (chart: Locator, label: string) =>
  chart.getByRole('button', { name: new RegExp(`^${label} · `) });

async function pickFromDrawer(page: Page, title: string, row: string) {
  const drawer = page.getByRole('dialog', { name: title });
  await drawer.getByRole('searchbox').fill(row);
  await drawer
    .getByRole('button')
    .filter({ has: page.getByText(row, { exact: true }) })
    .click();
  await expect(drawer).toBeHidden();
}

test('an extraction marks the tooth missing, Undo restores it, and implant placement makes it an implant', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, { name: 'Presence Visit', phone: '03 555 201' });
  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 1' });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page.getByRole('timer', { name: 'Visit time' })).toHaveText(/^\d{2}:\d{2}$/);

  const chart = chartCard(page);
  const panel = page.getByRole('complementary', { name: 'Selected tooth' });
  await tooth(chart, '#46').click();
  await expect(panel.getByRole('button', { name: 'Presence of tooth 46: Present' })).toBeVisible();

  await test.step('the extraction marks #46 missing at once', async () => {
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Extraction');
    const added = page.getByRole('status').filter({ hasText: 'Extraction added' });
    await expect(added).toContainText('tooth marked missing');
    await expect(tooth(chart, '#46')).toHaveAccessibleName(/ · missing · /);
    await expect(
      panel.getByRole('button', { name: 'Presence of tooth 46: Missing' }),
    ).toBeVisible();
    await expect(panel).toContainText(/Missing since .* · Extraction, visit V-\d{6}/);
    await expect(chart.locator('[data-column="46"] [data-presence="missing"]')).toBeVisible();

    await test.step('Undo removes the service and restores the tooth', async () => {
      await added.getByRole('button', { name: 'Undo' }).click();
      await expect(tooth(chart, '#46')).not.toHaveAccessibleName(/missing/);
      await expect(
        panel.getByRole('button', { name: 'Presence of tooth 46: Present' }),
      ).toBeVisible();
    });
  });

  await test.step('marked missing from the Presence menu, with its own Undo toast', async () => {
    await panel.getByRole('button', { name: 'Presence of tooth 46: Present' }).click();
    await page.getByRole('menuitemradio', { name: 'Missing' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Tooth 46 marked missing' }),
    ).toBeVisible();
    await expect(tooth(chart, '#46')).toHaveAccessibleName(/ · missing · /);
  });

  await test.step('implant placement on the gap makes it an implant, drawn with its mark', async () => {
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Implant placement');
    await expect(
      page.getByRole('status').filter({ hasText: 'Implant placement added' }),
    ).toContainText('marked as implant');
    await expect(tooth(chart, '#46')).toHaveAccessibleName(/ · implant · /);
    const glyph = chart.locator('[data-column="46"] [data-presence="implant"]');
    await expect(glyph).toBeVisible();
    await expect(glyph.locator('[data-implant-post]')).toBeVisible();
    // Still chartable: a diagnosis goes on the implant position (H3).
    await panel.getByRole('button', { name: 'Add diagnosis', exact: true }).click();
    await pickFromDrawer(page, 'Add diagnosis', 'Dental caries');
    await expect(
      page.getByRole('status').filter({ hasText: 'Dental caries recorded' }),
    ).toBeVisible();
    // The legend explains the three presence marks.
    for (const label of ['Missing', 'Not erupted', 'Implant']) {
      await expect(
        chart.getByRole('group', { name: 'Tooth' }).getByText(label, { exact: true }),
      ).toBeVisible();
    }
  });
});

test('Edit presence marks a new patient’s gaps and implant in one batch, before first visit', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, { name: 'Presence Intake', phone: '03 555 202' });
  await page.getByRole('tab', { name: 'Dental chart' }).click();
  const chart = chartCard(page);
  await chart.getByRole('button', { name: 'Edit presence' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Edit presence' });
  await expect(toolbar.getByRole('radio', { name: 'Missing' })).toBeChecked();

  for (const label of ['#18', '#28', '#38', '#48']) await tooth(chart, label).click();
  await toolbar.getByRole('radio', { name: 'Implant' }).click();
  await tooth(chart, '#36').click();
  await expect(toolbar.getByRole('status')).toHaveText('5 changes');
  // The marks are drawn before anything is saved.
  await expect(tooth(chart, '#18')).toHaveAccessibleName(/ · missing · /);

  await toolbar.getByRole('button', { name: 'Done' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save 5 changes' });
  await expect(dialog.getByRole('radio', { name: 'Before first visit' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: '5 teeth updated' })).toBeVisible();
  await expect(toolbar).toBeHidden();

  for (const label of ['#18', '#28', '#38', '#48']) {
    await expect(tooth(chart, label)).toHaveAccessibleName(/ · missing · /);
  }
  await expect(tooth(chart, '#36')).toHaveAccessibleName(/ · implant · /);
  await tooth(chart, '#36').click();
  const panel = page.getByRole('complementary', { name: 'Selected tooth' });
  // No date was invented.
  await expect(panel).toContainText('Implant · before first visit');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Treatment summary' })).toContainText(
    'Missing teeth: 4 · Implants: 1',
  );
  const compact = page.getByRole('region', { name: 'Dental status' });
  await expect(compact.locator('[data-column="18"] [data-presence="missing"]')).toBeVisible();
  await expect(compact.locator('[data-column="36"] [data-presence="implant"]')).toBeVisible();
});

test('a balance adjustment shows at once on the record and the statement, and in Activity', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, {
    name: 'Adjusted Amal',
    phone: '03 555 203',
    openingBalance: '120',
  });
  await page.getByRole('tab', { name: 'Balance & payments' }).click();

  await test.step('reduces the $120 balance by $20 as a courtesy', async () => {
    await page.getByRole('button', { name: 'Adjust balance' }).click();
    const panel = page.getByRole('dialog', { name: 'Adjust balance' });
    await expect(panel).toContainText('Adjusted Amal');
    await expect(panel.getByRole('radio', { name: 'Patient owes less' })).toBeChecked();
    await panel.getByLabel('Amount').fill('20');
    await panel.getByLabel('Reason').selectOption({ label: 'Courtesy / goodwill' });
    await expect(panel).toContainText(/Balance after\s*\$100/);
    await panel.getByRole('button', { name: 'Reduce balance by $20' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Balance adjusted' })).toBeVisible();
    const history = page.getByRole('table', { name: 'Payment history' });
    await expect(history).toContainText('Courtesy / goodwill');
    await expect(history).toContainText('−$20');
    await expect(page.getByRole('region', { name: 'Balance' })).toContainText('$100');
  });

  await test.step('the statement lists the adjustment and the new balance', async () => {
    const opened = page.context().waitForEvent('page');
    await page
      .getByRole('status')
      .filter({ hasText: 'Balance adjusted' })
      .getByRole('button', { name: 'Statement' })
      .click();
    const statement = await opened;
    await expect(statement.getByRole('heading', { level: 1 })).toContainText('Account statement');
    await expect(statement.getByText(/Adjustment · Courtesy \/ goodwill/)).toBeVisible();
    await expect(statement.getByText('$100').first()).toBeVisible();
    await statement.close();
  });

  await test.step('a payment, then Activity: Payments · 7 days → expand → the receipt', async () => {
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Record payment' });
    await dialog.getByLabel('Amount taken now').fill('30');
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: '$30 recorded' })).toBeVisible();

    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await page
      .getByRole('group', { name: 'Area' })
      .getByRole('button', { name: 'Payments' })
      .click();
    await page.getByRole('combobox', { name: 'Date' }).selectOption({ label: '7 days' });
    const table = page.getByRole('table', { name: 'Activity' });
    const payment = table.getByRole('row').filter({ hasText: 'Recorded payment RCT-000001' });
    await expect(payment).toContainText('$30');
    await expect(payment).toContainText('Dr. Hardening Owner');
    await expect(
      table.getByRole('row').filter({ hasText: 'Reduced the balance of Adjusted Amal by $20' }),
    ).toContainText('Courtesy / goodwill');
    // One row per thing done: no ledger shadow of the payment, no stored events.
    await expect(table.getByRole('row').filter({ hasText: 'RCT-000001' })).toHaveCount(1);

    await payment.getByRole('button', { name: 'Show what changed' }).click();
    // Only the changed fields, as before → after pairs: never raw JSON.
    await expect(table).toContainText(/Method\s*—\s*→\s*(changed to)?\s*cash/);
    await expect(table).not.toContainText('{');

    const opened = page.context().waitForEvent('page');
    await payment.getByRole('button', { name: 'RCT-000001' }).click();
    const receipt = await opened;
    await expect(receipt.getByRole('heading', { level: 1, name: 'Receipt' })).toBeVisible();

    await test.step('the receipt prints on one A4 page, whatever the browser default', async () => {
      await receipt.emulateMedia({ media: 'print' });
      // Letter is asked for; the sheet's own `@page { size: A4 }` wins.
      const pdf = await receipt.pdf({ format: 'Letter', preferCSSPageSize: true });
      const text = pdf.toString('latin1');
      expect(text.match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(1);
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
      // A4 is 595 × 842 pt (Letter would be 612 × 792).
      expect(Math.round(Number(box?.[1]))).toBe(595);
      expect(Math.round(Number(box?.[2]))).toBe(842);
    });
    await receipt.close();
  });

  await test.step('"View all activity" from the patient quick view lands pre-filtered', async () => {
    await page.getByRole('link', { name: 'Patients' }).click();
    const list = page.getByRole('table', { name: 'Patients' });
    await expect(list).toHaveAttribute('aria-busy', 'false');
    await list
      .getByRole('row')
      .filter({ hasText: 'Adjusted Amal' })
      .getByRole('button', { name: 'Actions for Adjusted Amal' })
      .click();
    await page.getByRole('menuitem', { name: 'Quick view' }).click();
    await page.getByRole('link', { name: 'View all activity' }).click();
    await expect(page).toHaveURL(/\/activity\?.*patient=[0-9a-f-]{36}/);
    await expect(page.getByText('Adjusted Amal').first()).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Activity' }).getByRole('row').filter({
        hasText: 'Registered patient Adjusted Amal',
      }),
    ).toBeVisible();
  });
});
