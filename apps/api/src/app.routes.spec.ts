import type { Type } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { APP_IMPORTS } from './app.module';
import { routeAccess } from './platform/http/route-access';

type Handler = (...args: unknown[]) => unknown;

function controllersOf(modules: readonly Type[]): Type[] {
  return modules.flatMap(
    (module) =>
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) as Type[] | undefined) ?? [],
  );
}

function routesOf(controller: Type): [string, Handler][] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name): [string, unknown] => [name, prototype[name]])
    .filter((entry): entry is [string, Handler] => typeof entry[1] === 'function')
    .filter(([, handler]) => Reflect.getMetadata(PATH_METADATA, handler) !== undefined);
}

describe('route declarations (CLAUDE.md §6)', () => {
  const reflector = new Reflector();
  const controllers = controllersOf(APP_IMPORTS);

  it('finds the application controllers', () => {
    expect(controllers.length).toBeGreaterThan(3);
  });

  it('declares @Public, @Authenticated or @RequirePermission on every route', () => {
    const undeclared = controllers.flatMap((controller) =>
      routesOf(controller)
        .filter(
          ([, handler]) =>
            routeAccess(reflector, {
              getHandler: () => handler,
              getClass: () => controller,
            }) === undefined,
        )
        .map(([name]) => `${controller.name}.${name}`),
    );
    expect(undeclared).toEqual([]);
  });
});
