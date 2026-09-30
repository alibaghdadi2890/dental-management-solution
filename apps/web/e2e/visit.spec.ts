import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/** The clinic every test of this file works in: provisioned once per worker, so the flows share
 * nothing with other files (their clinics, the dev tenant) and each registers its own patients. */
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

/** The platform admin provisions a clinic (Lebanon and USD by default, the default catalog) whose
 * owner is a dentist, and gives its branch two rooms (a live visit holds its room, and the resume
 * flow leaves one live); the owner then chooses their own password. */
async function provisionClinic(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const name = `Visit Clinic ${run}`;
  const owner = { email: `visit-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Visit Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await expect(panel.getByLabel('Practitioner type')).toHaveValue('dentist');
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  await page.getByText(name).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('link', { name: 'Branches & rooms' }).click();
  for (const [index, room] of ['Room 1', 'Room 2'].entries()) {
    await page.getByRole('button', { name: 'Add room' }).click();
    await page
      .getByRole('textbox', { name: 'Code' })
      .nth(index)
      .fill(`R${String(index + 1)}`);
    await page.getByRole('textbox', { name: 'Name' }).nth(index).fill(room);
  }
  await expect(page.getByRole('region', { name: '2 unsaved changes' })).toBeVisible();
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

/** Registers a patient from the list's header panel and opens their record; returns its path. */
async function registerPatient(
  page: Page,
  patient: { name: string; phone?: string; dateOfBirth?: string; openingBalance?: string },
): Promise<string> {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  const form = page.getByRole('complementary', { name: 'Register a patient' });
  await form.getByRole('textbox', { name: /^Full name/ }).fill(patient.name);
  if (patient.phone) await form.getByRole('textbox', { name: /^Phone/ }).fill(patient.phone);
  if (patient.dateOfBirth) {
    await form.getByRole('textbox', { name: /^Date of birth/ }).fill(patient.dateOfBirth);
  }
  if (patient.openingBalance) {
    await form.getByRole('textbox', { name: /^Opening balance/ }).fill(patient.openingBalance);
  }
  await form.getByRole('button', { name: 'Create patient' }).click();
  await expect(form).toBeHidden();

  const table = page.getByRole('table', { name: 'Patients' });
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await table.getByRole('row').filter({ hasText: patient.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: patient.name })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Record header → Start visit → the popover (the owner is the branch's dentist, pre-selected)
 * with the given room → the workspace. */
async function startVisit(page: Page, room: 'Room 1' | 'Room 2') {
  await page.getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: room });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('timer', { name: 'Visit time' })).toHaveText(/^\d{2}:\d{2}$/);
}

/** The workspace's full chart (not the plan board's tooth links). */
const chartCard = (page: Page) => page.getByRole('region', { name: 'Dental chart' });

/** A chart tooth by its notation label: its accessible name is its hover title, `#16 · …`. */
const tooth = (chart: Locator, label: string) =>
  chart.getByRole('button', { name: new RegExp(`^${label} · `) });

/** Picks a catalog row in the open drawer, narrowed by the search box first (a frequent row is
 * listed twice without a query). */
async function pickFromDrawer(page: Page, title: string, row: string) {
  const drawer = page.getByRole('dialog', { name: title });
  await drawer.getByRole('searchbox').fill(row);
  await drawer
    .getByRole('button')
    .filter({ has: page.getByText(row, { exact: true }) })
    .click();
  await expect(drawer).toBeHidden();
}

const seconds = (text: string) => {
  const [minutes = '0', rest = '0'] = text.split(':');
  return Number(minutes) * 60 + Number(rest);
};

test('the owner charts a visit, completes it and sees its figures with the opening balance', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, { name: 'Rana Khoury', phone: '03 555 101', openingBalance: '40' });
  await startVisit(page, 'Room 1');
  const chart = chartCard(page);
  const panel = page.getByRole('complementary', { name: 'Selected tooth' });

  await test.step('#16: a diagnosis, its planned treatment, performed now', async () => {
    await tooth(chart, '#16').click();
    await expect(tooth(chart, '#16')).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Add diagnosis', exact: true }).click();
    await pickFromDrawer(page, 'Add diagnosis', 'Dental caries');
    const recorded = page.getByRole('status').filter({ hasText: 'Dental caries recorded' });
    await recorded.getByRole('button', { name: 'Plan treatment' }).click();
    await pickFromDrawer(page, 'Add planned treatment', 'Zircon crown');
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown planned' }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Perform now: Zircon crown' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown performed' }),
    ).toBeVisible();
    await expect(tooth(chart, '#16')).toHaveAccessibleName(/treated in this visit/);
  });

  await test.step('#26: surfaces O and D scope a composite', async () => {
    await tooth(chart, '#26').click();
    const surfaces = panel.getByRole('group', { name: 'Tooth surfaces' });
    await surfaces.getByRole('button', { name: 'Occlusal (O)' }).click();
    await surfaces.getByRole('button', { name: 'Distal (D)' }).click();
    await expect(panel.getByText('Surfaces selected: Occlusal, Distal')).toBeVisible();
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Composite');
    await expect(page.getByRole('status').filter({ hasText: 'Composite added' })).toBeVisible();
    await expect(surfaces.getByRole('button', { name: /^Occlusal \(O\) · treated/ })).toBeVisible();
    await expect(surfaces.getByRole('button', { name: /^Distal \(D\) · treated/ })).toBeVisible();
  });

  await test.step('a note autosaves and a 10 % discount comes off the total', async () => {
    const notes = page.getByRole('region', { name: 'Clinical notes' });
    await notes
      .getByRole('textbox', { name: 'Clinical notes' })
      .fill('Occlusal caries on #16, crown prepared.');
    await expect(notes.getByRole('status')).toHaveText('✓Saved just now');

    await page.getByRole('radio', { name: 'Percent' }).click();
    await page.getByRole('textbox', { name: 'Visit discount value' }).fill('10');
    await expect(page.getByRole('group', { name: 'Services' })).toContainText('$400');
    await expect(page.getByRole('group', { name: 'Discount amount' })).toContainText('$40');
    await expect(page.getByRole('group', { name: 'Visit total' })).toContainText('$360');
  });

  await test.step('Review & complete → Complete visit → the post-visit figures', async () => {
    await page.getByRole('button', { name: 'Review & complete' }).click();
    const summary = page.getByRole('dialog', { name: 'Complete visit' });
    await expect(summary).toContainText(/Total due\s*\$360/);
    await summary.getByRole('button', { name: 'Complete visit' }).click();

    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}(\?.*)?$/);
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await expect(recorded.getByText('Unpaid', { exact: true })).toBeVisible();
    const thisVisit = recorded.getByRole('region', { name: 'This visit' });
    await expect(thisVisit).toContainText(/Services\s*\$400/);
    await expect(thisVisit).toContainText(/Visit total\s*\$360/);
    await expect(thisVisit).toContainText(/Outstanding for this visit\s*\$360/);
    await expect(recorded.getByRole('region', { name: 'Previous visits' })).toContainText(
      /Outstanding from earlier visits\s*\$40/,
    );
    await expect(recorded).toContainText(/Total outstanding[\s\S]*\$400/);
    await recorded.getByRole('button', { name: 'Pay later' }).click();
    await expect(recorded).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start visit' })).toBeVisible();
  });
});

test('the same user resumes a live visit from another browser and the timer carries on', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInAsOwner(page);
  const recordPath = await registerPatient(page, { name: 'Omar Saleh', phone: '03 555 202' });
  await startVisit(page, 'Room 1');
  const visitUrl = page.url();
  const firstTimer = page.getByRole('timer', { name: 'Visit time' });
  // A few seconds on the clock first, so a timer restarting from zero can't pass.
  await expect(firstTimer).not.toHaveText(/^00:0[0-3]$/, { timeout: 10_000 });

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await signInAsOwner(second);
    await second.goto(recordPath);
    await second.getByRole('button', { name: 'Resume visit' }).click();
    await expect(second).toHaveURL(visitUrl);
    const secondTimer = second.getByRole('timer', { name: 'Visit time' });
    await expect(secondTimer).toHaveText(/^\d{2}:\d{2}$/);

    // Both run from the server's clock: read together, they agree within two seconds, and the
    // second browser carries on from where the first one is rather than from zero.
    const [a, b] = await Promise.all([firstTimer.textContent(), secondTimer.textContent()]);
    expect(Math.abs(seconds(a ?? '') - seconds(b ?? ''))).toBeLessThanOrEqual(2);
    expect(seconds(b ?? '')).toBeGreaterThanOrEqual(4);
  } finally {
    await other.close();
  }
});

test('Universal notation relabels the charts; a dentition override changes the chart, not the records', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  const adultPath = await registerPatient(page, { name: 'Nadim Aoun', phone: '03 555 303' });
  // A date of birth mid-March eight years back: a child in the mixed dentition whatever today is.
  const childDob = `15/03/${String(new Date().getFullYear() - 8)}`;
  const childPath = await registerPatient(page, { name: 'Maya Aoun', dateOfBirth: childDob });

  const setNotation = async (label: 'Universal notation' | 'FDI notation', toast: RegExp) => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page.getByText(label, { exact: true }).click();
    await expect(page.getByRole('radio', { name: new RegExp(label) })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: toast })).toBeVisible();
  };

  await setNotation('Universal notation', /^Universal notation enabled/);
  try {
    await test.step('the Overview chart: #3 for 16, A for 55', async () => {
      await page.goto(adultPath);
      const adultChart = page.getByRole('region', { name: 'Dental status' });
      await expect(tooth(adultChart, '#3')).toHaveAccessibleName(/^#3 · Upper right first molar/);
      await expect(adultChart.locator('[data-column="16"]')).toHaveAccessibleName(/^#3 · /);

      await page.goto(childPath);
      const childChart = page.getByRole('region', { name: 'Dental status' });
      await expect(childChart.locator('[data-column="15"]')).toHaveAccessibleName(/^A · /);
      await expect(tooth(childChart, 'A')).toHaveAccessibleName(/primary tooth/);
    });

    await test.step('Permanent relabels the column; Back to auto finds the record again', async () => {
      await startVisit(page, 'Room 2');
      const chart = chartCard(page);
      await tooth(chart, 'A').click();
      await page
        .getByRole('complementary', { name: 'Selected tooth' })
        .getByRole('button', { name: 'Add diagnosis', exact: true })
        .click();
      await pickFromDrawer(page, 'Add diagnosis', 'Dental caries');
      await expect(tooth(chart, 'A')).toHaveAccessibleName(/Dental caries/);

      await chart.getByRole('button', { name: /^Dentition: Auto · Mixed/ }).click();
      await page.getByRole('menuitemradio', { name: 'Permanent' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Dentition set to Permanent' }),
      ).toBeVisible();
      await expect(chart.locator('[data-column="15"]')).toHaveAccessibleName(
        /^#4 · .*no recorded treatment$/,
      );
      await expect(tooth(chart, 'A')).toHaveCount(0);

      await chart.getByRole('button', { name: /^Dentition: Permanent · set manually/ }).click();
      await page.getByRole('menuitemradio', { name: 'Back to auto' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Dentition back to automatic' }),
      ).toBeVisible();
      await expect(tooth(chart, 'A')).toHaveAccessibleName(/Dental caries/);
    });
  } finally {
    await setNotation('FDI notation', /^FDI notation enabled/);
  }
});
