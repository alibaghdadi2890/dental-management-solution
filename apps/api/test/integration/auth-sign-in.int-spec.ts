import type { ProblemDetails } from '@dcm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import {
  asSystem,
  browser,
  createPlatformAdmin,
  PASSWORD,
  signIn,
  uniqueEmail,
} from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const SIGN_IN = '/api/v1/auth/sign-in/email';

describe('sign-in (D11)', () => {
  let database: TestDatabase;
  let testApp: TestApp;

  const trustedFlags = async (email: string) =>
    (
      await database.ownerPool.query<{ trusted: boolean }>(
        'select s.trusted from auth_sessions s join auth_users u on u.id = s.user_id where u.email = $1',
        [email],
      )
    ).rows.map((row) => row.trusted);

  const attempt = (email: string, password: string) =>
    browser(testApp.app).post(SIGN_IN).send({ email, password });

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('signs in with a session cookie that ends with the browser session', async () => {
    const email = await createPlatformAdmin(testApp.app);

    const response = await attempt(email, PASSWORD);

    expect(response.status).toBe(204);
    const cookie = response.headers['set-cookie'] as unknown as string[];
    const session = cookie.find((c) => c.startsWith('dcm.session_token='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).not.toMatch(/Max-Age/i);
    expect(await trustedFlags(email)).toEqual([false]);
  });

  it('keeps a trusted workstation signed in for 30 days', async () => {
    const email = await createPlatformAdmin(testApp.app);

    const response = await browser(testApp.app)
      .post(SIGN_IN)
      .send({ email, password: PASSWORD, rememberMe: true });

    const cookie = response.headers['set-cookie'] as unknown as string[];
    expect(cookie.find((c) => c.startsWith('dcm.session_token='))).toMatch(/Max-Age=2592000/);
    expect(await trustedFlags(email)).toEqual([true]);
  });

  it('counts down failed attempts, then locks the account for 15 minutes', async () => {
    const email = await createPlatformAdmin(testApp.app);

    for (const left of [4, 3, 2, 1]) {
      const response = await attempt(email, 'wrong-password');
      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.body).toMatchObject({ code: 'auth.invalid_credentials', attemptsLeft: left });
    }
    const fifth = await attempt(email, 'wrong-password');
    expect(fifth.status).toBe(401);
    expect(fifth.body).toMatchObject({ code: 'auth.account_locked' });
    expect((fifth.body as ProblemDetails).lockedUntil).toBeDefined();

    // Even the right password is refused while locked.
    expect((await attempt(email, PASSWORD)).body).toMatchObject({ code: 'auth.account_locked' });

    testApp.clock.advance({ minutes: 15 });
    expect((await attempt(email, PASSWORD)).status).toBe(204);
  });

  it('treats unknown emails exactly like known ones', async () => {
    const response = await attempt(uniqueEmail('nobody'), 'whatever-password');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'auth.invalid_credentials', attemptsLeft: 4 });
  });

  it('resets the count after a successful sign-in', async () => {
    const email = await createPlatformAdmin(testApp.app);
    await attempt(email, 'wrong-password');
    await attempt(email, PASSWORD);
    expect((await attempt(email, 'wrong-password')).body).toMatchObject({ attemptsLeft: 4 });
  });

  it('matches emails case-insensitively', async () => {
    const email = await createPlatformAdmin(testApp.app);
    expect((await attempt(email.toUpperCase(), PASSWORD)).status).toBe(204);
  });

  it('refuses deactivated accounts', async () => {
    const email = uniqueEmail('staff');
    await asSystem(testApp.app, () =>
      testApp.app
        .get(AuthService)
        .createIdentity({ name: 'Front Desk', email, temporaryPassword: PASSWORD }),
    );
    await database.ownerPool.query('update auth_users set banned = true where email = $1', [email]);

    const response = await attempt(email, PASSWORD);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'auth.account_deactivated' });
  });

  it('validates the request body', async () => {
    const response = await browser(testApp.app).post(SIGN_IN).send({ email: 'x' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'validation_failed' });
  });

  it('exposes no sign-up or plugin endpoints', async () => {
    for (const path of ['sign-up/email', 'organization/create', 'admin/create-user']) {
      const response = await browser(testApp.app).post(`/api/v1/auth/${path}`).send({});
      expect(response.status, path).toBe(404);
    }
  });

  it('signs out and clears the cookie', async () => {
    const email = await createPlatformAdmin(testApp.app);
    const agent = await signIn(testApp.app, email);

    const response = await agent.post('/api/v1/auth/sign-out').send();

    expect(response.status).toBe(204);
    const cookie = response.headers['set-cookie'] as unknown as string[];
    expect(cookie.find((c) => c.startsWith('dcm.session_token='))).toMatch(/Max-Age=0/);
  });
});
