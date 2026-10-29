import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';
import { chooseTreatment, completeFromSummary, openAllView } from './start-visit';

/**
 * Feature 10, visit flows: the three stories of its acceptance — a new patient's examination end
 * to end, a treatment visit that continues work in progress, and an emergency. One clinic per
 * worker, with the default catalog and medical-history lists; each story registers its patient.
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

/** The platform admin provisions a clinic whose owner is a dentist, with three rooms (each story
 * holds one while its visit is live); the owner then chooses their own password. */
async function provisionClinic(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const name = `Flow Clinic ${run}`;
  const owner = { email: `flow-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Flow Owner');
  await panel.getByLabel('Email').fill(owner.email);
  await panel.getByRole('button', { name: 'Generate' }).click();
  const temporaryPassword = await panel.getByLabel('Temporary password').inputValue();
  await panel.getByRole('button', { name: 'Create tenant' }).click();
  // Several suites provision a clinic at once: give this one time.
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible({
    timeout: 20_000,
  });

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

/** The header panel, filled with a name and a phone; the caller finishes it. */
async function openRegistration(page: Page, name: string, phone: string): Promise<Locator> {
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  const form = page.getByRole('complementary', { name: 'Register a patient' });
  await form.getByRole('textbox', { name: /^Full name/ }).fill(name);
  await form.getByRole('textbox', { name: /^Phone/ }).fill(phone);
  return form;
}

/** Registers a patient and opens their record. */
async function registerPatient(page: Page, name: string, phone: string) {
  const form = await openRegistration(page, name, phone);
  await form.getByRole('button', { name: 'Create patient' }).click();
  await expect(form).toBeHidden();
  const table = page.getByRole('table', { name: 'Patients' });
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await table.getByRole('row').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const steps = (page: Page, type: string) =>
  page.getByRole('navigation', { name: `${type} visit steps` });
const chartCard = (page: Page) => page.getByRole('region', { name: 'Dental chart' });
const tooth = (page: Page, label: string) =>
  chartCard(page).getByRole('button', { name: new RegExp(`^${label} · `) });

async function pickFromDrawer(page: Page, title: string, row: string) {
  const drawer = page.getByRole('dialog', { name: title });
  await drawer.getByRole('searchbox').fill(row);
  await drawer
    .getByRole('button')
    .filter({ has: page.getByText(row, { exact: true }) })
    .click();
  await expect(drawer).toBeHidden();
}

/** The Complete step's Complete visit, which completes at once, and the post-visit dialog. */
async function completeVisit(page: Page) {
  await page.getByRole('button', { name: 'Complete visit' }).click();
  await expect(page.getByRole('dialog', { name: 'Complete visit' })).toHaveCount(0);
  const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
  await expect(recorded).toBeVisible();
  return recorded;
}

test('a new patient’s examination, from registration to the plan', async ({ page }) => {
  test.slow();
  await signInAsOwner(page);

  await test.step('registered with two allergies, one new to the clinic', async () => {
    const form = await openRegistration(page, 'Nour Examination', '03 555 901');
    const allergies = form.getByRole('group', { name: 'Allergies' });
    const box = allergies.getByRole('combobox', { name: 'Allergies' });
    // Typing suggests the clinic's list; Enter takes the suggestion and the box is ready again.
    await box.fill('pen');
    await expect(allergies.getByRole('option')).toHaveText(['Penicillin', 'Add “pen”']);
    await box.press('Enter');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('');
    // A name the clinic does not have yet is added on the way.
    await box.fill('Kiwi');
    await allergies.getByRole('option', { name: 'Add “Kiwi”' }).click();
    await expect(allergies.getByRole('listitem')).toHaveText([/^Penicillin/, /^Kiwi/]);
    await form
      .getByRole('group', { name: 'First visit' })
      .getByRole('button', { name: 'Examination' })
      .click();
    await form.getByRole('button', { name: 'Create and start Examination' }).click();

    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await expect(popover.getByRole('radio', { name: /^Examination/ })).toBeChecked();
    await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 1' });
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
  });

  const nav = steps(page, 'Examination');
  await test.step('Intake: the history is corrected and confirmed', async () => {
    await expect(nav.getByRole('button', { name: /^Intake/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const history = page.getByRole('region', { name: 'Medical history' });
    await expect(history).toContainText('Registered by front desk · not confirmed');
    // The header's chips follow the history as it is corrected.
    await expect(page.getByRole('list', { name: 'Medical alerts' })).toContainText('Penicillin');

    await expect(page.getByRole('list', { name: 'Medical alerts' })).toContainText('Kiwi');

    await history.getByRole('button', { name: 'Remove Penicillin' }).click();
    await history.getByRole('button', { name: 'Remove Kiwi' }).click();
    const box = history.getByRole('combobox', { name: 'Allergies' });
    // Kiwi is on the clinic's list from now on.
    await box.fill('ki');
    await expect(history.getByRole('option', { name: 'Kiwi', exact: true })).toBeVisible();
    await box.fill('lat');
    await box.press('Enter');
    await expect(page.getByRole('list', { name: 'Medical alerts' })).toHaveText('Latex');
    await history.getByRole('checkbox', { name: /Confirmed with the patient/ }).click();
    await expect(history).toContainText(/Confirmed by Dr\. Flow Owner · \d{2}:\d{2}/);
    await expect(history).not.toContainText('not confirmed');
    // The step holds a record now: it is ticked.
    await expect(nav.getByRole('button', { name: /^Intake/ })).toContainText('✓');
  });

  await test.step('Examine: a diagnosis, and on to its proposal', async () => {
    await page.getByRole('button', { name: 'Continue to Examine' }).click();
    await expect(page.getByRole('region', { name: 'Evidence' })).toContainText('No images yet.');
    await tooth(page, '#24').click();
    const panel = page.getByRole('complementary', { name: 'Selected tooth' });
    await panel.getByRole('button', { name: 'Record Deep caries' }).click();
    const recorded = page.getByRole('status').filter({ hasText: 'Deep caries recorded' });
    await recorded.getByRole('button', { name: 'Plan treatment' }).click();
    await expect(nav.getByRole('button', { name: /^Plan/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  await test.step('Plan: Composite proposed at High, listed as New', async () => {
    const card = page.getByRole('region', { name: '#24 · Deep caries' });
    await expect(card).toBeFocused();
    await card.getByRole('button', { name: 'Propose Composite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Composite planned' })).toBeVisible();
    await expect(card.getByRole('radio', { name: 'High' })).toBeChecked();
    const high = page.getByRole('region', { name: 'High', exact: true });
    await expect(high).toContainText('#24');
    await expect(high).toContainText('New');
    await expect(high).toContainText('$50');
  });

  await test.step('Plan: other treatment on a tooth that has no diagnosis', async () => {
    await page.getByRole('button', { name: '+ Add other treatment' }).click();
    const other = page.getByRole('region', { name: 'Other treatment' });
    await other.getByRole('combobox', { name: 'Where' }).selectOption('36');
    await other.getByRole('radio', { name: 'Elective' }).click();
    await other.getByRole('button', { name: 'Propose Composite', exact: true }).click();
    await expect(other.getByRole('listitem')).toContainText(['#36']);
    await expect(page.getByRole('region', { name: 'Elective', exact: true })).toContainText('#36');
  });

  await test.step('Findings lists what was recorded today', async () => {
    await nav.getByRole('button', { name: /^Findings/ }).click();
    const table = page.getByRole('table', { name: 'Diagnoses' });
    await expect(table).toContainText('Deep caries');
    await expect(table).toContainText('Composite');
    await expect(table).toContainText('Everything older is planned.');
  });

  await test.step('Perform is there, optional, with the plan and today’s services', async () => {
    const perform = nav.getByRole('button', { name: /^Perform/ });
    await expect(perform).toContainText('optional');
    await perform.click();
    await expect(perform).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('region', { name: "Today's services" })).toContainText(
      'Examination',
    );
    await expect(
      page.getByRole('button', { name: 'Perform now: Composite' }).first(),
    ).toBeVisible();
  });

  await test.step('Complete: the visit summed up, the automatic service, and done', async () => {
    await nav.getByRole('button', { name: /^Complete/ }).click();
    const block = page.getByRole('region', { name: 'This visit' }).first();
    await expect(block).toContainText('1 diagnosis');
    await expect(block).toContainText('2 items, $100');
    await expect(block).toContainText('1 service · $25');
    const today = page.getByRole('region', { name: "Today's services" });
    await expect(today).toContainText('Examination');
    await expect(today).toContainText('added automatically');

    const recorded = await completeVisit(page);
    await expect(recorded.getByRole('region', { name: 'This visit' })).toContainText(
      /Visit total\s*\$25/,
    );
  });
});

test('a treatment visit opens on today’s work and continues it', async ({ page }) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, 'Tarek Treatment', '03 555 902');

  await test.step('an earlier visit leaves a root canal in progress and a crown planned', async () => {
    await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
    await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 2' });
    await chooseTreatment(popover);
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
    await openAllView(page);

    const panel = page.getByRole('complementary', { name: 'Selected tooth' });
    const today = page.getByRole('region', { name: "Today's services" });
    await tooth(page, '#26').click();
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Root canal treatment');
    await today.getByRole('button', { name: 'Actions: Root canal treatment' }).click();
    await page.getByRole('menuitem', { name: 'Not finished' }).click();
    await expect(today.getByText('Not finished')).toBeVisible();

    await tooth(page, '#16').click();
    await panel.getByRole('button', { name: 'Add planned treatment', exact: true }).click();
    await pickFromDrawer(page, 'Add planned treatment', 'Zircon crown');
    await expect(
      page.getByRole('status').filter({ hasText: 'Zircon crown planned' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Review & complete' }).click();
    // The check asks about the root canal: session 1, so it continues.
    await completeFromSummary(page);
    const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
    await recorded.getByRole('button', { name: 'Done' }).click();
    await expect(recorded).toBeHidden();
  });

  await test.step('the plan tab: the crown becomes urgent and accepted', async () => {
    await page.getByRole('tab', { name: 'Treatment plan' }).click();
    const high = page.getByRole('region', { name: 'High', exact: true });
    await high
      .getByRole('combobox', { name: 'Priority of the treatment for Zircon crown' })
      .selectOption({ label: 'Urgent' });
    const urgent = page.getByRole('region', { name: 'Urgent', exact: true });
    await expect(urgent).toContainText('Zircon crown');
    await expect(urgent).toContainText('$350');
    await urgent.getByRole('button', { name: 'Mark Zircon crown accepted' }).click();
    await expect(urgent).toContainText('✓ Accepted');
  });

  await test.step('the Overview says what needs attention', async () => {
    await page.getByRole('tab', { name: 'Overview' }).click();
    const attention = page.getByRole('region', { name: 'Needs attention' });
    const rows = attention.getByRole('listitem');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Root canal treatment');
    await expect(rows.nth(0)).toContainText('Session 2 of 3 not finished');
    await expect(rows.nth(0).getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(rows.nth(1)).toContainText('Zircon crown');
    await expect(rows.nth(1).getByRole('button', { name: 'Treat' })).toBeVisible();
    // The root canal was charged in the visit that started it (ADR-0064).
    await expect(rows.nth(2)).toContainText('$180 unpaid');
    // Registered without a date of birth or sex: the record says so last (ADR-0052).
    await expect(rows.nth(3)).toContainText('Missing information');
  });

  await test.step('Start visit suggests Treatment and asks nothing about the plan', async () => {
    await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
    const popover = page.getByRole('dialog', { name: 'Start visit' });
    await expect(popover.getByRole('radio', { name: /^Treatment/ })).toBeChecked();
    await expect(popover.getByRole('checkbox')).toHaveCount(0);
    await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 2' });
    await popover.getByRole('button', { name: 'Start visit' }).click();
    await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);
  });

  const nav = steps(page, 'Treatment');
  await test.step('Today’s work: the plan with today’s ticks, started by Perform', async () => {
    await expect(nav.getByRole('button', { name: /^Today’s work/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    // The work in progress and the urgent crown start ticked; the crown is not for today.
    const rootCanal = page.getByRole('checkbox', { name: 'For today: #26 Root canal treatment' });
    const crown = page.getByRole('checkbox', { name: 'For today: #16 Zircon crown' });
    await expect(rootCanal).toBeChecked();
    await expect(crown).toBeChecked();
    await expect(page.getByText('2 treatments for today')).toBeVisible();
    await crown.click();
    await expect(crown).not.toBeChecked();
    await expect(page.getByText('1 treatment for today')).toBeVisible();
    await expect(page.getByRole('region', { name: 'High', exact: true })).toContainText(
      'Session 2 of 3',
    );
    await page.getByRole('button', { name: 'Continue Root canal treatment' }).click();

    await expect(nav.getByRole('button', { name: /^Perform/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const panel = page.getByRole('complementary', { name: 'Selected tooth' });
    await expect(panel.getByRole('heading', { name: '#26' })).toBeVisible();
    // Entering Perform logged this visit's session, with no charge: the first visit charged it.
    const services = page.getByRole('region', { name: "Today's services" });
    // Worked on here, it is no longer waiting "To continue".
    await expect(services.getByText(/^To continue/)).toHaveCount(0);
    await expect(services).toContainText('Root canal treatment');
    await expect(services).toContainText('Charged on visit');
    await expect(services).toContainText('$0');
  });

  await test.step('Complete: it continues next visit', async () => {
    await page.getByRole('button', { name: 'Continue to Complete' }).click();
    // Session 2 of 3: the check suggests it continues.
    const check = page.getByRole('dialog', { name: 'Before you complete' });
    await expect(check.getByText('Session 2 of 3')).toBeVisible();
    await expect(
      check
        .getByRole('radiogroup', { name: '#26 Root canal treatment: finished or continues' })
        .getByRole('radio', { name: 'Continues' }),
    ).toHaveAttribute('aria-checked', 'true');
    await check.getByRole('button', { name: 'Continue to Complete' }).click();
    const block = page.getByRole('region', { name: 'This visit' }).first();
    await expect(block).toContainText('Continues next visit');
    await expect(block).toContainText('#26 Root canal treatment');
    await expect(page.getByText('Next visit: Root canal treatment · #26 (continue)')).toBeVisible();
    await completeVisit(page);
  });
});

test('an emergency: the complaint, the automatic examination, and an extraction', async ({
  page,
}) => {
  test.slow();
  await signInAsOwner(page);
  await registerPatient(page, 'Elie Emergency', '03 555 903');

  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 3' });
  await popover.getByRole('radio', { name: /^Emergency/ }).check();
  await popover.getByRole('textbox', { name: 'Reason' }).fill('Broken molar');
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}$/);

  const nav = steps(page, 'Emergency');
  await test.step('Complaint: pain 8, for one to three days', async () => {
    await expect(nav.getByRole('button', { name: /^Complaint/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByRole('textbox', { name: 'Complaint' })).toHaveValue('Broken molar');
    await expect(page.getByText('Not rated')).toBeVisible();
    await page.getByRole('slider', { name: 'Pain' }).fill('8');
    await expect(page.getByText('8 / 10')).toBeVisible();
    await page.getByRole('button', { name: '1–3 days' }).click();
    await expect(page.getByRole('button', { name: '1–3 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('Treat now: the emergency examination is there; the tooth comes out', async () => {
    await nav.getByRole('button', { name: /^Treat now/ }).click();
    const today = page.getByRole('region', { name: "Today's services" });
    await expect(today).toContainText('Emergency examination');
    await expect(today).toContainText('added automatically');

    await tooth(page, '#36').click();
    const panel = page.getByRole('complementary', { name: 'Selected tooth' });
    await panel.getByRole('button', { name: 'Add completed service', exact: true }).click();
    await pickFromDrawer(page, 'Add completed service', 'Extraction');
    await expect(today).toContainText('Extraction');
    await expect(tooth(page, '#36')).toHaveAccessibleName(/missing/i);
  });

  await test.step('Complete: both services are charged', async () => {
    await page.getByRole('button', { name: 'Continue to Complete' }).click();
    // The extraction, added by hand, is suggested Finished.
    const check = page.getByRole('dialog', { name: 'Before you complete' });
    await expect(
      check
        .getByRole('radiogroup', { name: '#36 Extraction: finished or continues' })
        .getByRole('radio', { name: 'Finished' }),
    ).toHaveAttribute('aria-checked', 'true');
    await check.getByRole('button', { name: 'Continue to Complete' }).click();
    await expect(page.getByRole('region', { name: 'This visit' }).first()).toContainText(
      '2 services · $60',
    );
    const recorded = await completeVisit(page);
    await expect(recorded.getByRole('region', { name: 'This visit' })).toContainText(
      /Visit total\s*\$60/,
    );
  });
});
