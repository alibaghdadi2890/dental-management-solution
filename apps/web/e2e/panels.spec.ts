import { expect, type Locator, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

const VIEWPORT = { width: 1440, height: 900 };

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * A right panel is its full 440px against the window's right edge, and opening it (it slides in
 * and focuses a field) left the page where it was: nothing scrolled the screen sideways.
 */
async function expectDockedRight(page: Page, panel: Locator) {
  await expect(panel).toBeVisible();
  await panel.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished)),
  );
  const box = await panel.boundingBox();
  expect(box?.width).toBe(440);
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(VIEWPORT.width);
  expect(await page.getByRole('main').evaluate((main) => main.scrollLeft)).toBe(0);
}

test.use({ viewport: VIEWPORT });

test('a right panel is full width, docked right, and leaves the page where it was', async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page).toHaveURL(/\/admin\/tenants$/);

  // The Tenants list holds its panel in its own row.
  await page.getByRole('button', { name: 'New tenant' }).first().click();
  const name = `Panels ${Date.now().toString(36)}`;
  const create = page.getByRole('complementary', { name: 'Create a clinic' });
  await expectDockedRight(page, create);
  await create.getByLabel('Clinic name').fill(name);
  await create.getByLabel('Branch name').fill('Main St');
  await create.getByLabel('Full name').fill('Pat Panel');
  await create.getByLabel('Email').fill(`panels-${Date.now().toString(36)}@e2e.test`);
  await create.getByRole('button', { name: 'Generate' }).click();
  await create.getByRole('button', { name: 'Create tenant' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tenant created' })).toBeVisible();

  // The tenant page (like the clinic's Settings) renders its panels through `PanelLayout`.
  await page.getByText(name).click();
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).first().click();
  await expectDockedRight(page, page.getByRole('complementary', { name: 'Add a staff member' }));
});
