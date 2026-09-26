import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const E2E_ADMIN = {
  email: process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@dcm.local',
  password: process.env['E2E_ADMIN_PASSWORD'] ?? 'e2e-admin-password',
};

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Makes sure the platform admin the identity flow signs in with exists (idempotent CLI, D10).
 * Needs the local stack: `docker compose up -d --wait` and migrations (`pnpm dev` does both).
 */
export default function globalSetup(): void {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@dcm/api',
      'admin:bootstrap',
      '--email',
      E2E_ADMIN.email,
      '--password',
      E2E_ADMIN.password,
    ],
    // Windows resolves pnpm.cmd only through a shell; the arguments contain no spaces.
    { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}
