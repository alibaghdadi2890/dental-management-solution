import '../load-env';
import { parseArgs } from 'node:util';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CORE_PLATFORM_MODULES } from '../app.module';
import { AuthModule, AuthService } from '../modules/auth';
import { RequestContext } from '../platform/cls/request-context';
import { newId } from '../platform/kernel/id';

@Module({ imports: [...CORE_PLATFORM_MODULES, AuthModule] })
class BootstrapModule {}

const USAGE =
  'Usage: pnpm --filter @dcm/api admin:bootstrap --email <email> --password <password> [--name <name>]';

/**
 * Creates the first platform admin (D10), or promotes an existing account. Idempotent. Runs as a
 * system actor outside any tenant; never exposed through the UI.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string', default: 'Platform admin' },
    },
  });
  if (!values.email || !values.password) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const { email, password, name } = values;

  const app = await NestFactory.createApplicationContext(BootstrapModule, { logger: ['error'] });
  try {
    const outcome = await app
      .get(RequestContext)
      .run({ requestId: `cli:${newId()}`, actorKind: 'system' }, () =>
        app.get(AuthService).bootstrapPlatformAdmin({ email, password, name }),
      );
    const messages = {
      created: `Platform admin ${email} created.`,
      promoted: `Existing user ${email} is now a platform admin.`,
      unchanged: `${email} is already a platform admin; nothing changed.`,
    };
    console.log(messages[outcome]);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
