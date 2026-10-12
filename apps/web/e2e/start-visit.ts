import { expect, type Locator, type Page } from '@playwright/test';

/**
 * For the suites that chart in the whole workspace: in the Start visit popover, a **Treatment**
 * visit — the one type that adds no service by itself, so their totals are only what they add.
 */
export async function chooseTreatment(popover: Locator): Promise<void> {
  await popover.getByRole('radio', { name: /^Treatment/ }).check();
}

/** Switches a started visit from its steps to **All**: the whole workspace, every card. */
export async function openAllView(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'All', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Dental chart' })).toBeVisible();
}
