import type { Session } from '@dcm/contracts';
import { expect, type Page, test } from '@playwright/test';

const session: Session = {
  user: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
    displayName: 'Maria Reyes',
    email: 'reyes@example.com',
  },
  platformAdmin: false,
  mustChangePassword: false,
  tenant: {
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f',
    name: 'Northgate Dental',
    slug: 'northgate',
    timeZone: 'America/New_York',
    currency: 'USD',
    locale: 'en',
  },
  branch: { id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70', name: 'Main St' },
  branches: [{ id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70', name: 'Main St' }],
  roleNames: ['Dentist'],
  permissions: ['patient:read', 'visit:read'],
  idleTimeoutSeconds: 900,
};

// Stub the session contract so the shell renders without a backend (real flow: identity.spec.ts).
async function signedIn(page: Page) {
  await page.route('**/api/v1/session', (route) => route.fulfill({ json: session }));
}

test('lands on Patients inside the app shell', async ({ page }) => {
  await signedIn(page);
  await page.goto('/');

  await expect(page).toHaveURL(/\/patients$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Northgate Dental/Patients',
  );
  await expect(page.getByText('Clinic · Main St')).toBeVisible();
  await expect(page.getByText('Maria Reyes')).toBeVisible();
});

test('navigates between phase 1 screens from the sidebar', async ({ page }) => {
  await signedIn(page);
  await page.goto('/patients');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Visits' }).click();

  await expect(page).toHaveURL(/\/visits$/);
  await expect(nav.getByRole('link', { name: 'Visits' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Visits' })).toBeVisible();
});

test('switches to a right-to-left layout in Arabic', async ({ page }) => {
  await signedIn(page);
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'ar');
  });
  await page.goto('/visits');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'الزيارات' })).toBeVisible();
});
