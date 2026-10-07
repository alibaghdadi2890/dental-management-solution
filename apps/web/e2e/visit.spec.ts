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
 * owner is a dentist, and gives its branch three rooms (a live visit holds its room, and the resume
 * and notation flows each leave one live); the owner then chooses their own password. */
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
  for (const [index, room] of ['Room 1', 'Room 2', 'Room 3'].entries()) {
    await page.getByRole('button', { name: 'Add room' }).click();
    await page
      .getByRole('textbox', { name: 'Code' })
      .nth(index)
      .fill(`R${String(index + 1)}`);
    await page.getByRole('textbox', { name: 'Name' }).nth(index).fill(room);
  }
  await expect(page.getByRole('region', { name: '3 unsaved changes' })).toBeVisible();
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
 * with the given room → the workspace. `asked`: the visit opens under the unfinished services
 * question, which hides the rest of the page from the accessibility tree until it is answered. */
async function startVisit(page: Page, room: 'Room 1' | 'Room 2' | 'Room 3', asked = false) {
  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: room });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
  if (asked) {
    await expect(page.getByRole('dialog', { name: 'Unfinished services' })).toBeVisible();
    return;
  }
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
    // A frequently used service is one click away at the top of the panel.
    await panel.getByRole('button', { name: 'Add Composite', exact: true }).click();
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
    await recorded.getByRole('button', { name: 'Done' }).click();
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

test('Universal notation relabels the charts; the chart toggle switches between primary and permanent teeth', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  const adultPath = await registerPatient(page, { name: 'Nadim Aoun', phone: '03 555 303' });
  // A date of birth mid-March eight years back: a child, so the primary chart opens first.
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

    await test.step('Permanent shows the other chart; Primary finds the record again', async () => {
      await startVisit(page, 'Room 2');
      const chart = chartCard(page);
      await tooth(chart, 'A').click();
      await page
        .getByRole('complementary', { name: 'Selected tooth' })
        .getByRole('button', { name: 'Add diagnosis', exact: true })
        .click();
      await pickFromDrawer(page, 'Add diagnosis', 'Dental caries');
      await expect(tooth(chart, 'A')).toHaveAccessibleName(/Dental caries/);

      // The other chart: the same column holds the permanent tooth, with nothing recorded.
      await chart.getByRole('button', { name: 'Permanent', exact: true }).click();
      await expect(chart.locator('[data-column="15"]')).toHaveAccessibleName(
        /^#4 · .*no recorded treatment$/,
      );
      await expect(tooth(chart, 'A')).toHaveCount(0);
      // The switch is remembered on the patient.
      await page.reload();
      await expect(chart.getByRole('button', { name: 'Permanent', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await chart.getByRole('button', { name: 'Primary', exact: true }).click();
      await expect(tooth(chart, 'A')).toHaveAccessibleName(/Dental caries/);
    });
  } finally {
    await setNotation('FDI notation', /^FDI notation enabled/);
  }
});

test('a completed visit is amended with a reason, then voided, from the Visits screen', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, { name: 'Lina Haddad', phone: '03 555 404' });
  await startVisit(page, 'Room 3');
  const chart = chartCard(page);
  const panel = page.getByRole('complementary', { name: 'Selected tooth' });

  await test.step('two composites, completed', async () => {
    for (const label of ['#36', '#46']) {
      await tooth(chart, label).click();
      await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
      await pickFromDrawer(page, 'Add completed service', 'Composite');
      await expect(
        page.getByRole('status').filter({ hasText: 'Composite added' }).first(),
      ).toBeVisible();
    }
    await page.getByRole('button', { name: 'Review & complete' }).click();
    await page
      .getByRole('dialog', { name: 'Complete visit' })
      .getByRole('button', { name: 'Complete visit' })
      .click();
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
  });

  const table = page.getByRole('table', { name: 'Visits' });
  const row = table.getByRole('row').filter({ hasText: 'Lina Haddad' });
  const details = page.getByRole('complementary', { name: 'Lina Haddad' });
  const figure = (label: string) =>
    details.getByText(label, { exact: true }).locator('xpath=following-sibling::span');

  await test.step('the Visits screen lists it, completed and unpaid', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Visits' })
      .click();
    await expect(row).toContainText('Completed');
    await row.click();
    await expect(details.getByText('Composite', { exact: true }).first()).toBeVisible();
  });

  let before = '';
  await test.step('amend: remove one composite with a reason; the balance follows', async () => {
    before = (await figure('Total').textContent()) ?? '';
    await details.getByRole('button', { name: 'Amend' }).click();
    await details
      .getByRole('button', { name: /^Remove / })
      .last()
      .click();
    await details.getByRole('button', { name: 'Save amendment' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText(`Total changes ${before} →`);
    await confirm.getByLabel('Reason for amendment').fill('Second filling not placed');
    await confirm.getByRole('button', { name: 'Save amendment' }).click();
    await expect(page.getByRole('status').filter({ hasText: /amended$/ })).toBeVisible();
    await expect(row).toContainText('Amended');
    await row.click();
    const after = (await figure('Total').textContent()) ?? '';
    expect(after).not.toBe(before);
    await expect(figure('Balance')).toHaveText(after);
    await expect(details.getByText(/^Amended — Second filling not placed/)).toBeVisible();
  });

  await test.step('void with a reason: struck through in the list and in the history', async () => {
    await details.getByRole('button', { name: 'Void' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByLabel('Reason for voiding').fill('Wrong patient');
    await confirm.getByRole('button', { name: 'Void visit' }).click();
    await expect(page.getByRole('status').filter({ hasText: /voided$/ })).toBeVisible();
    await expect(row).toContainText('Voided');
    await expect(row.getByRole('cell').nth(5)).toHaveClass(/line-through/);

    await row.click();
    await details.getByRole('link', { name: 'Open in record' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lina Haddad' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Visits & history', selected: true })).toBeVisible();
    const history = page.getByRole('tabpanel', { name: 'Visits & history' });
    await expect(history.getByText('Voided', { exact: true }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Balance & payments' }).click();
    await expect(page.getByRole('region', { name: 'Balance' })).toContainText(
      /Total outstanding\s*\$0/,
    );
  });
});

test('a service not finished in one visit is continued in the next and billed by the visit that completes it', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, { name: 'Hadi Nassar', phone: '03 555 505' });

  await test.step('the Dental chart tab plans a crown on #36 without a visit', async () => {
    await page.getByRole('tab', { name: 'Dental chart' }).click();
    const chart = chartCard(page);
    await tooth(chart, '#36').click();
    await page
      .getByRole('complementary', { name: 'Selected tooth' })
      .getByRole('button', { name: 'Add planned treatment', exact: true })
      .click();
    await pickFromDrawer(page, 'Add planned treatment', 'Zircon crown');
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown planned' }),
    ).toBeVisible();
    await expect(tooth(chart, '#36')).toHaveAccessibleName(/planned: Zircon crown/);
  });

  const board = page.getByRole('region', { name: 'Treatment plan' });
  const today = page.getByRole('region', { name: "Today's services" });
  const question = page.getByRole('dialog', { name: 'Unfinished services' });
  const complete = async () => {
    await page.getByRole('button', { name: 'Review & complete' }).click();
    const summary = page.getByRole('dialog', { name: 'Complete visit' });
    return summary;
  };
  const record = async (summary: Locator, total: RegExp) => {
    await summary.getByRole('button', { name: 'Complete visit' }).click();
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await expect(recorded.getByRole('region', { name: 'This visit' })).toContainText(total);
    return recorded;
  };

  await test.step('first visit: the crown is not finished, a whole-mouth scaling is charged', async () => {
    await startVisit(page, 'Room 3');
    await board.getByRole('button', { name: 'Perform now: Zircon crown' }).click();
    await expect(page.getByRole('group', { name: 'Visit total' })).toContainText('$350');
    await today.getByRole('button', { name: 'Actions: Zircon crown' }).click();
    await page.getByRole('menuitem', { name: 'Not finished' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown marked not finished' }),
    ).toBeVisible();
    await expect(today.getByText('Not finished')).toBeVisible();
    await expect(tooth(chartCard(page), '#36')).toHaveAccessibleName(/not finished: Zircon crown/);

    await chartCard(page)
      .getByRole('button', { name: /^Whole mouth/ })
      .click();
    const area = page.getByRole('complementary', { name: 'Selected tooth' });
    await expect(area.getByRole('heading', { name: 'Whole mouth' })).toBeVisible();
    await area.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Scaling & polishing');
    await expect(today).toContainText('Scaling & polishing');
    await expect(page.getByRole('group', { name: 'Visit total' })).toContainText('$60');

    const summary = await complete();
    await expect(summary).toContainText('Zircon crown · visit 1');
    await expect(summary).toContainText(/Total due\s*\$60/);
    const recorded = await record(summary, /Visit total\s*\$60/);
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
  });

  await test.step('second visit: asked as it opens, continued, and nothing is charged', async () => {
    await startVisit(page, 'Room 3', true);
    await expect(question).toContainText('Zircon crown');
    await question.getByRole('button', { name: 'Continue' }).click();
    await expect(question).toBeHidden();
    await expect(today).toContainText('2 visits');

    const summary = await complete();
    await expect(summary).toContainText('Zircon crown · visit 2');
    await expect(summary).toContainText(/Total due\s*\$0/);
    const recorded = await record(summary, /Visit total\s*\$0/);
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
  });

  await test.step('third visit: "Not today", then continued from the card and completed', async () => {
    await startVisit(page, 'Room 3', true);
    await question.getByRole('button', { name: 'Not today' }).click();
    await expect(question).toBeHidden();
    await expect(today.getByText('To continue · 1')).toBeVisible();
    await today.getByRole('button', { name: 'Actions: Zircon crown' }).click();
    await page.getByRole('menuitem', { name: 'Continue' }).click();
    await today.getByRole('button', { name: 'Complete: Zircon crown' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown performed' }),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Visit total' })).toContainText('$350');

    const recorded = await record(await complete(), /Visit total\s*\$350/);
    await expect(recorded).toContainText(/Total outstanding[\s\S]*\$410/);
  });
});
