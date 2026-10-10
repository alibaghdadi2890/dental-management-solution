import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * Feature 9 (chart marks): colours and icons chosen in the Catalog show on the dental chart,
 * which is read as Diagnoses, Services or Both; work of today is told from earlier work; the
 * legend lists what is on the chart and highlights it. One clinic and one patient, in order.
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

/** The platform admin provisions a clinic (the default catalog) whose owner is a dentist and
 * gives its branch a room; the owner then chooses their own password. */
async function provisionClinic(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const name = `Marks Clinic ${run}`;
  const owner = { email: `marks-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Marks Owner');
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

const chartCard = (page: Page) => page.getByRole('region', { name: 'Dental chart' });

/** A chart tooth by its notation label: its accessible name starts `#16 · …`. */
const tooth = (chart: Locator, label: string) =>
  chart.getByRole('button', { name: new RegExp(`^${label} · `) });

/** A tooth's column, by FDI code: where its glyph, cells, band and dots are. */
const column = (chart: Locator, code: string) => chart.locator(`[data-column="${code}"]`);
const cell = (chart: Locator, code: string, surface: string) =>
  column(chart, code).locator(`[data-surface="${surface}"]`);

async function pickFromDrawer(page: Page, title: string, row: string) {
  const drawer = page.getByRole('dialog', { name: title });
  await drawer.getByRole('searchbox').fill(row);
  await drawer
    .getByRole('button')
    .filter({ has: page.getByText(row, { exact: true }) })
    .click();
  await expect(drawer).toBeHidden();
}

async function startVisit(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 1' });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page.getByRole('timer', { name: 'Visit time' })).toHaveText(/^\d{2}:\d{2}$/);
}

/** Scopes the surfaces in the tooth panel, then adds the frequently used Composite. */
async function addComposite(page: Page, chart: Locator, label: string, surfaces: string[]) {
  const panel = page.getByRole('complementary', { name: 'Selected tooth' });
  await tooth(chart, label).click();
  const group = panel.getByRole('group', { name: 'Tooth surfaces' });
  for (const surface of surfaces) await group.getByRole('button', { name: surface }).click();
  await panel.getByRole('button', { name: 'Add Composite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Composite added' })).toBeVisible();
}

test('catalog colours and icons show on the chart, in each view, today told from before', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.owner.email, clinic.owner.password);
  await expect(page).toHaveURL(/\/patients$/);

  await test.step('the Catalog gives the crown a colour, an icon and a priority', async () => {
    await page.getByRole('link', { name: 'Catalog' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
    // The seeded marks: a composite is blue with the filling icon.
    await expect(
      page.getByRole('button', { name: 'Chart colour of Composite: Blue' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Chart icon of Composite: Filling' }),
    ).toBeVisible();
    // A service on the whole mouth is never drawn on a tooth.
    const scaling = page.getByRole('row').filter({ has: page.locator('input[value="SCL"]') });
    await expect(scaling.getByText('Not shown on a tooth')).toBeAttached();

    await page.getByRole('button', { name: 'Chart colour of Zircon crown: Purple' }).click();
    const colours = page.getByRole('dialog', { name: 'Chart colour' });
    await colours.getByRole('button', { name: 'Raise the chart priority' }).click();
    await colours.getByRole('button', { name: 'Raise the chart priority' }).click();
    await colours.getByRole('button', { name: 'Raise the chart priority' }).click();
    await expect(colours.getByRole('status', { name: 'Chart priority' })).toHaveText('8');
    await colours.getByRole('button', { name: 'Amber' }).click();
    await expect(colours).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Chart colour of Zircon crown: Amber' }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Diagnoses' }).click();
    await page.getByRole('button', { name: 'Chart colour of Dental caries: Rose' }).click();
    await page
      .getByRole('dialog', { name: 'Chart colour' })
      .getByRole('button', { name: 'Magenta' })
      .click();
    await expect(page.getByRole('region', { name: '2 unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved 2 catalog changes' }),
    ).toBeVisible();
  });

  await test.step('a first visit: a filling on #36 O·D, a crown on #16, caries on #46 M', async () => {
    await page.getByRole('link', { name: 'Patients' }).click();
    await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
    const form = page.getByRole('complementary', { name: 'Register a patient' });
    await form.getByRole('textbox', { name: /^Full name/ }).fill('Maya Chart');
    await form.getByRole('textbox', { name: /^Phone/ }).fill('03 555 909');
    await form.getByRole('button', { name: 'Create patient' }).click();
    await expect(form).toBeHidden();
    const table = page.getByRole('table', { name: 'Patients' });
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await table.getByRole('row').filter({ hasText: 'Maya Chart' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maya Chart' })).toBeVisible();

    await startVisit(page);
    const chart = chartCard(page);
    const panel = page.getByRole('complementary', { name: 'Selected tooth' });
    await addComposite(page, chart, '#36', ['Occlusal (O)', 'Distal (D)']);

    await tooth(chart, '#16').click();
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Zircon crown');
    await expect(page.getByRole('status').filter({ hasText: 'Zircon crown added' })).toBeVisible();

    await tooth(chart, '#46').click();
    await panel
      .getByRole('group', { name: 'Tooth surfaces' })
      .getByRole('button', { name: 'Mesial (M)' })
      .click();
    await panel.getByRole('button', { name: 'Add diagnosis', exact: true }).click();
    await pickFromDrawer(page, 'Add diagnosis', 'Dental caries');
    await expect(
      page.getByRole('status').filter({ hasText: 'Dental caries recorded' }),
    ).toBeVisible();

    // Today's work is the saturated fill; the crown paints every surface and has its chip.
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-fill', 'blue/today');
    await expect(cell(chart, '16', 'O')).toHaveAttribute('data-fill', 'amber/today');
    // The palette reaches the page: the theme's blue, at full strength.
    await expect(cell(chart, '36', 'O')).toHaveCSS('background-color', 'rgb(47, 85, 212)');
    await expect(column(chart, '16').locator('[data-chip="service:ZIR"]')).toBeVisible();

    await page.getByRole('button', { name: 'Review & complete' }).click();
    await page
      .getByRole('dialog', { name: 'Complete visit' })
      .getByRole('button', { name: 'Complete visit' })
      .click();
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
  });

  await test.step('the record chart reads as Both, Diagnoses and Services, and remembers', async () => {
    await page.getByRole('tab', { name: 'Dental chart' }).click();
    const chart = chartCard(page);
    const views = chart.getByRole('radiogroup', { name: 'Show on the chart' });
    await expect(views.getByRole('radio', { name: 'Both' })).toBeChecked();

    // Both: services paint, at the tone of earlier work; the diagnosis is a dot by the number.
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-fill', 'blue/past');
    await expect(cell(chart, '36', 'D')).toHaveAttribute('data-fill', 'blue/past');
    await expect(cell(chart, '36', 'O')).toHaveCSS('background-color', 'rgb(154, 169, 238)');
    await expect(cell(chart, '36', 'M')).toHaveAttribute('data-fill', 'none');
    await expect(cell(chart, '16', 'B')).toHaveAttribute('data-fill', 'amber/past');
    await expect(column(chart, '16').locator('[data-chip="service:ZIR"]')).toBeVisible();
    await expect(column(chart, '46').locator('[data-diagnosis-dot="magenta"]')).toHaveCount(1);
    await expect(cell(chart, '46', 'M')).toHaveAttribute('data-fill', 'none');
    await expect(tooth(chart, '#36')).toHaveAccessibleName(
      /Composite · O · D · .* · Dr\. Marks Owner/,
    );

    await views.getByRole('radio', { name: 'Diagnoses' }).click();
    await expect(cell(chart, '46', 'M')).toHaveAttribute('data-fill', 'magenta/today');
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-fill', 'none');
    await expect(cell(chart, '16', 'B')).toHaveAttribute('data-fill', 'none');
    await expect(column(chart, '16').locator('[data-chip]')).toHaveCount(0);

    await views.getByRole('radio', { name: 'Diagnoses' }).press('ArrowRight');
    await expect(views.getByRole('radio', { name: 'Services' })).toBeChecked();
    await expect(cell(chart, '46', 'M')).toHaveAttribute('data-fill', 'none');
    await expect(column(chart, '46').locator('[data-diagnosis-dot]')).toHaveCount(0);
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-fill', 'blue/past');

    await page.reload();
    await expect(
      chartCard(page)
        .getByRole('radiogroup', { name: 'Show on the chart' })
        .getByRole('radio', { name: 'Services' }),
    ).toBeChecked();
    await chartCard(page).getByRole('radio', { name: 'Both' }).click();
  });

  await test.step('a second visit: today stands out, and the legend highlights the fillings', async () => {
    await startVisit(page);
    const chart = chartCard(page);
    await addComposite(page, chart, '#46', ['Occlusal (O)']);
    await expect(cell(chart, '46', 'O')).toHaveAttribute('data-fill', 'blue/today');
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-fill', 'blue/past');
    // A tooth is selected: the legend's highlight starts from none.
    await page.keyboard.press('Escape');

    const fillings = chart.getByRole('button', { name: /^Composite · 2 teeth$/ });
    await expect(fillings).toHaveAttribute('aria-pressed', 'false');
    await fillings.click();
    await expect(fillings).toHaveAttribute('aria-pressed', 'true');
    await expect(column(chart, '16').locator('[data-glyph]')).toHaveAttribute('data-faded', 'true');
    await expect(column(chart, '36').locator('[data-glyph]')).not.toHaveAttribute('data-faded');
    await expect(column(chart, '46').locator('[data-glyph]')).not.toHaveAttribute('data-faded');
    await expect(cell(chart, '36', 'O')).toHaveAttribute('data-ringed', 'true');

    await page.keyboard.press('Escape');
    await expect(fillings).toHaveAttribute('aria-pressed', 'false');
    await expect(column(chart, '16').locator('[data-glyph]')).not.toHaveAttribute('data-faded');
  });
});
