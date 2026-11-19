import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { E2E_ADMIN } from './global-setup';

/**
 * Feature 20a, inventory: the acceptance's spine — the owner adds an item, Sara the assistant
 * receives it without prices, the owner prices the receipt and pays the supplier (an expense
 * appears), Sara takes stock out until it is low on Today, marks it ordered, and the owner counts
 * and applies the count.
 */
const PASSWORD = 'correct-horse-battery';
const TEMPORARY = 'temporary-pw-1';
const ORIGIN = 'http://localhost:5173';
const ITEM = 'Nitrile gloves M';
const SUPPLIER = 'DentaLeb';

interface Clinic {
  owner: string;
  sara: string;
}

type Api = (method: string, path: string, data?: unknown, key?: string) => Promise<unknown>;

const apiFor =
  (request: APIRequestContext): Api =>
  async (method, path, data, key) => {
    const response = await request.fetch(`/api/v1${path}`, {
      method,
      ...(data === undefined ? {} : { data }),
      headers: { origin: ORIGIN, ...(key ? { 'Idempotency-Key': key } : {}) },
    });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  };

const signInApi = (api: Api, email: string, password: string) =>
  api('POST', '/auth/sign-in/email', { email, password, rememberMe: true });

/** A clinic set up through the API: the flows under test are inventory's. */
async function provision(browser: Browser): Promise<Clinic> {
  const run = Date.now().toString(36);
  const context = await browser.newContext({ baseURL: ORIGIN });
  const api = apiFor(context.request);
  await signInApi(api, E2E_ADMIN.email, E2E_ADMIN.password);
  const owner = `stock-owner-${run}@e2e.test`;
  await api('POST', '/platform/tenants', {
    clinic: { name: `Stock ${run}`, slug: `stock-${run}` },
    firstBranch: { name: 'Main St' },
    owner: { displayName: 'Dr. Ana Reyes', email: owner, temporaryPassword: TEMPORARY },
  });
  await context.clearCookies();
  await signInApi(api, owner, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  const [branch] = (await api('GET', '/branches')) as { id: string }[];
  if (!branch) throw new Error('no branch');
  await api('POST', '/inventory/suppliers', { name: SUPPLIER, email: 'orders@dentaleb.test' });
  const sara = `stock-sara-${run}@e2e.test`;
  await api('POST', '/users', {
    displayName: 'Sara Haddad',
    email: sara,
    practitionerType: 'assistant',
    roleKeys: ['assistant'],
    branchIds: [branch.id],
    temporaryPassword: TEMPORARY,
  });
  await context.clearCookies();
  await signInApi(api, sara, TEMPORARY);
  await api('POST', '/session/password', { currentPassword: TEMPORARY, newPassword: PASSWORD });
  await context.close();
  return { owner, sara };
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

const stockRow = (page: Page) =>
  page.getByRole('table', { name: 'Stock' }).getByRole('row').filter({ hasText: ITEM });

async function takeOneBox(page: Page) {
  await stockRow(page).getByRole('button', { name: 'Take out' }).click();
  await page.getByRole('menuitem', { name: '1 box' }).click();
  await expect(toast(page, `of ${ITEM} taken out`).last()).toBeVisible();
}

let clinic: Clinic;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  clinic = await provision(browser);
});

test('an item received, priced, paid, taken out, ordered and counted', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signIn(page, clinic.owner);

  await test.step('the owner adds the item the Catalog way', async () => {
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit items' }).click();
    await page.getByRole('button', { name: 'Add item' }).click();
    const row = page.getByRole('table', { name: 'Edit items' }).getByRole('row').nth(1);
    await row.getByLabel('Name').fill(ITEM);
    await row.getByLabel('Category').selectOption({ label: 'Disposables' });
    await row.getByLabel('Unit', { exact: true }).fill('piece');
    await row.getByLabel('Pack').fill('box');
    await row.getByLabel('Units').fill('100');
    await row.getByLabel('Reorder at').fill('200');
    await row.getByLabel('Usual supplier').selectOption({ label: SUPPLIER });
    await row.getByLabel('Usual order').fill('5');
    await page
      .getByRole('region', { name: /unsaved change/ })
      .getByRole('button', { name: /Save/ })
      .click();
    await expect(toast(page, '1 item saved')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(stockRow(page)).toBeVisible();
  });

  const saraPage = await browser.newPage({ baseURL: ORIGIN });
  await signIn(saraPage, clinic.sara);

  await test.step('Sara receives five boxes without prices', async () => {
    await saraPage.goto('/inventory');
    await saraPage.getByRole('link', { name: 'Receive' }).click();
    await expect(saraPage.getByRole('heading', { level: 1, name: 'Receive' })).toBeVisible();
    await saraPage.getByLabel('Supplier').selectOption({ label: SUPPLIER });
    await saraPage.getByLabel('Item').first().selectOption({ label: ITEM });
    await saraPage.getByLabel('Quantity').first().fill('5');
    await expect(saraPage.getByText('= 500 pieces')).toBeVisible();
    await expect(saraPage.getByLabel('Price')).toHaveCount(0);
    await saraPage.getByLabel('Invoice number').fill('INV-2207');
    await saraPage.getByRole('button', { name: 'Save receipt' }).click();
    await expect(saraPage.getByText('To price').first()).toBeVisible();
  });

  await test.step('the owner prices the receipt and pays the supplier', async () => {
    await page.goto('/inventory?tab=receipts');
    await page
      .getByRole('table', { name: 'Receipts' })
      .getByRole('row')
      .filter({ hasText: SUPPLIER })
      .click();
    await page.getByRole('button', { name: 'Price', exact: true }).click();
    await page.getByLabel('Price').fill('9');
    await page.getByRole('button', { name: 'Save prices' }).click();
    await expect(page.getByRole('definition').filter({ hasText: '$45' })).toBeVisible();

    await page.goto('/inventory?tab=suppliers');
    await page
      .getByRole('table', { name: 'Suppliers' })
      .getByRole('row')
      .filter({ hasText: SUPPLIER })
      .click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    const panel = page.getByRole('dialog', { name: 'Record payment' });
    await panel.getByLabel('Amount', { exact: true }).fill('45');
    await panel.getByRole('radio', { name: 'Cash' }).click();
    await panel.getByRole('button', { name: 'Record payment' }).click();
    await expect(toast(page, 'Payment recorded')).toBeVisible();

    await page.goto('/expenses');
    await expect(page.getByRole('main').getByText(SUPPLIER).first()).toBeVisible();
  });

  await test.step('Sara takes boxes out until it is low on Today, and marks it ordered', async () => {
    await saraPage.goto('/inventory');
    for (let box = 0; box < 2; box += 1) await takeOneBox(saraPage);

    // The third from the search, over Today: Enter takes the box offered; Undo puts it back.
    await saraPage.goto('/today');
    const takeOutFromSearch = async () => {
      await saraPage.getByRole('button', { name: 'Search', exact: true }).click();
      await saraPage
        .getByRole('combobox', { name: 'Search patients and stock items' })
        .fill('nitrile');
      await saraPage
        .getByRole('row', { name: new RegExp(ITEM) })
        .getByRole('button', { name: 'Take out' })
        .click();
      const panel = saraPage.getByRole('dialog', { name: 'Take out' });
      await expect(panel.getByLabel('Quantity')).toBeFocused();
      await expect(panel.getByLabel('Quantity')).toHaveValue('1');
      await saraPage.keyboard.press('Enter');
      await expect(toast(saraPage, `100 pieces · 1 box of ${ITEM} taken out`).last()).toBeVisible();
      await expect(saraPage).toHaveURL(/\/today/);
    };
    await takeOutFromSearch();
    await saraPage.getByRole('button', { name: 'Undo' }).click();
    await expect(toast(saraPage, 'Put back')).toBeVisible();
    await takeOutFromSearch();

    await saraPage.goto('/inventory');
    await expect(stockRow(saraPage)).toContainText('Low');
    await saraPage.goto('/today');
    await expect(saraPage.getByRole('link', { name: /Low\s*1/ })).toBeVisible();
    await saraPage.goto('/inventory');
    await stockRow(saraPage).getByText(ITEM).click();
    await saraPage.getByRole('button', { name: 'Mark ordered' }).click();
    await saraPage.getByRole('alertdialog').getByRole('button', { name: 'Mark ordered' }).click();
    await expect(saraPage.getByRole('dialog', { name: ITEM })).toContainText('Ordered');
    await saraPage.keyboard.press('Escape');
    await saraPage.goto('/today');
    await expect(saraPage.getByRole('link', { name: /Low\s*1/ })).toHaveCount(0);
  });
  await saraPage.close();

  await test.step('the owner counts and applies the difference', async () => {
    await page.goto('/inventory?tab=counts');
    await page.getByRole('button', { name: 'Start a count' }).click();
    await page.getByRole('button', { name: 'Count everything' }).click();
    await page.getByLabel(`Counted ${ITEM}`).fill('190');
    await page.getByLabel(`Counted ${ITEM}`).blur();
    await expect(page.getByRole('cell', { name: /−10/ })).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    await page
      .getByRole('dialog', { name: 'Differences' })
      .getByRole('button', { name: 'Apply' })
      .click();
    await expect(toast(page, 'Count applied')).toBeVisible();
    await page.goto('/inventory');
    await expect(stockRow(page)).toContainText('190');
  });
});
