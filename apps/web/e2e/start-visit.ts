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

/**
 * The Visit Summary's **Complete visit**, then — when the check before Complete has something to
 * ask (ADR-0065) — the check's own, keeping its suggestions.
 */
export async function completeFromSummary(page: Page): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Complete visit' })
    .getByRole('button', { name: 'Complete visit' })
    .click();
  const check = page.getByRole('dialog', { name: 'Before you complete' });
  const recorded = page.getByRole('dialog', { name: 'Visit recorded' });
  await expect(check.or(recorded)).toBeVisible();
  if (await check.isVisible()) {
    await check.getByRole('button', { name: 'Complete visit' }).click();
  }
}
