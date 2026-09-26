import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AuthService } from '../../src/modules/auth';
import { RequestContext } from '../../src/platform/cls/request-context';
import { newId } from '../../src/platform/kernel/id';
import { TEST_ORIGIN } from './test-app';

export const PASSWORD = 'correct-horse-battery';

/** A cookie-keeping client that talks to the app the way the SPA does (same origin). */
export function browser(app: INestApplication): TestAgent {
  return request.agent(app.getHttpServer() as Server).set('Origin', TEST_ORIGIN);
}

export async function signIn(
  app: INestApplication,
  email: string,
  password = PASSWORD,
  options: { rememberMe?: boolean } = {},
): Promise<TestAgent> {
  const agent = browser(app);
  const response = await agent
    .post('/api/v1/auth/sign-in/email')
    .send({ email, password, rememberMe: options.rememberMe ?? false });
  if (response.status !== 204) {
    throw new Error(`sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return agent;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${newId()}@example.test`;
}

/** Runs `fn` as a system task, like the admin bootstrap CLI. */
export function asSystem<T>(app: INestApplication, fn: () => Promise<T>): Promise<T> {
  return app.get(RequestContext).run({ requestId: `test-${newId()}`, actorKind: 'system' }, fn);
}

export async function createPlatformAdmin(app: INestApplication): Promise<string> {
  const email = uniqueEmail('admin');
  await asSystem(app, () =>
    app.get(AuthService).bootstrapPlatformAdmin({ email, password: PASSWORD, name: 'Ops Admin' }),
  );
  return email;
}
