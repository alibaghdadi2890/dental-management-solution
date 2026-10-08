import { type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * Feature 8 (patient files): a file dropped on the visit workspace is uploaded to object storage,
 * saved with one choice, shown in the visit's strip, opened in the viewer, rotated, archived and
 * brought back. One clinic, provisioned once. Needs the local stack's object storage.
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

/** The platform admin provisions a clinic whose owner is a dentist and gives its branch a room;
 * the owner then chooses their own password. */
async function provisionClinic(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const name = `Files Clinic ${run}`;
  const owner = { email: `files-owner-${run}@e2e.test`, password: 'owner-own-password-1' };
  const page = await browser.newPage();

  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const panel = page.getByRole('complementary', { name: 'Create a clinic' });
  await panel.getByLabel('Clinic name').fill(name);
  await panel.getByLabel('Branch name').fill('Main St');
  await panel.getByLabel('Full name').fill('Dr. Files Owner');
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

/** Registers a patient from the list's header panel and opens their record. */
async function registerPatient(page: Page, patient: { name: string; phone: string }) {
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'New patient' }).click();
  const form = page.getByRole('complementary', { name: 'Register a patient' });
  await form.getByRole('textbox', { name: /^Full name/ }).fill(patient.name);
  await form.getByRole('textbox', { name: /^Phone/ }).fill(patient.phone);
  await form.getByRole('button', { name: 'Create patient' }).click();
  await expect(form).toBeHidden();
  const table = page.getByRole('table', { name: 'Patients' });
  await expect(table).toHaveAttribute('aria-busy', 'false');
  await table.getByRole('row').filter({ hasText: patient.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: patient.name })).toBeVisible();
}

/**
 * A drag from the desktop: a `DataTransfer` holding a real PNG (wider than tall, so a rotation
 * shows), handed to the page's own drag events.
 */
async function dragFile(page: Page, name: string) {
  return page.evaluateHandle(async (filename) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.fillStyle = '#1b1a1f';
    context.fillRect(0, 0, 640, 320);
    context.fillStyle = '#e8e6df';
    context.fillRect(40, 120, 560, 80);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((made) => {
        if (made) resolve(made);
        else reject(new Error('no blob'));
      }, 'image/png');
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], filename, { type: 'image/png' }));
    return transfer;
  }, name);
}

test('a file dropped on a visit is saved, viewed, rotated, archived and restored', async ({
  page,
}) => {
  test.slow();
  await signIn(page, clinic.owner.email, clinic.owner.password);
  await expect(page).toHaveURL(/\/patients$/);
  await registerPatient(page, { name: 'Files Visit', phone: '03 555 801' });
  await page.getByRole('main').getByRole('button', { name: 'Start visit' }).click();
  const popover = page.getByRole('dialog', { name: 'Start visit' });
  await expect(popover.getByRole('combobox', { name: 'Dentist' })).toHaveValue(/.+/);
  await popover.getByRole('combobox', { name: 'Room' }).selectOption({ label: 'Room 1' });
  await popover.getByRole('button', { name: 'Start visit' }).click();
  await expect(page.getByRole('timer', { name: 'Visit time' })).toHaveText(/^\d{2}:\d{2}$/);

  const strip = page.getByRole('region', { name: 'Files' });
  await expect(strip).toContainText('Nothing added in this visit yet');
  const tile = strip.getByRole('button', { name: /panoramic\.png$/ });

  await test.step('drop → the panel opens with the visit pre-filled → one choice → Save', async () => {
    const transfer = await dragFile(page, 'panoramic.png');
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
    await expect(page.getByText('Drop to add to Files Visit')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });

    const panel = page.getByRole('dialog', { name: 'Add files' });
    await expect(panel).toContainText(/Visit V-\d{6} · today/);
    const save = panel.getByRole('button', { name: 'Save 1 file' });
    await expect(panel.getByText('No category yet')).toBeVisible();
    await expect(save).toBeDisabled();
    await panel.getByRole('radio', { name: 'X-ray' }).click();
    await panel.getByRole('button', { name: 'Panoramic', exact: true }).click();
    await save.click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: '1 file added' })).toBeVisible();
  });

  await test.step('it is first in the strip, with its thumbnail from object storage', async () => {
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAccessibleName(/^X-ray · Panoramic · /);
    const thumbnail = tile.locator('img');
    await expect(thumbnail).toHaveJSProperty('complete', true);
    expect(await thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(480);
  });

  const viewer = page.getByRole('dialog', { name: 'File viewer' });
  await test.step('the viewer rotates for viewing, and stores it on Save orientation', async () => {
    await tile.click();
    await expect(viewer).toContainText('1 / 1');
    await expect(viewer).toContainText('X-ray · Panoramic');
    await expect(viewer.getByRole('img')).toHaveJSProperty('naturalWidth', 640);
    await viewer.getByRole('button', { name: 'Rotate' }).click();
    await viewer.getByRole('button', { name: 'Save orientation' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Orientation saved' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save orientation' })).toBeHidden();
    // Stored: the strip's thumbnail, behind the viewer (and so out of the accessibility tree),
    // is turned too. The bytes are not.
    await expect(page.locator('section[aria-label="Files"] img')).toHaveCSS(
      'transform',
      'matrix(0, 1, -1, 0, 0, 0)',
    );
  });

  await test.step('archive with a reason closes the viewer; Undo brings the file back', async () => {
    await viewer.getByRole('button', { name: 'Archive' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Archive this file?' });
    await confirm.getByRole('textbox').fill('duplicate');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(viewer).toBeHidden();
    await expect(tile).toBeHidden();
    const archived = page.getByRole('status').filter({ hasText: 'Archived' });
    await archived.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toBeVisible();
    await expect(tile).toBeVisible();
  });

  await test.step('the record shows it under Files, with the count on the tab', async () => {
    await page.getByRole('link', { name: 'Files Visit' }).first().click();
    await page.getByRole('tab', { name: 'Files 1' }).click();
    const gallery = page.getByRole('tabpanel', { name: 'Files 1' });
    await expect(gallery.getByRole('region', { name: 'Today' })).toBeVisible();
    await expect(gallery.getByRole('button', { name: /panoramic\.png$/ }).first()).toBeVisible();
  });
});
