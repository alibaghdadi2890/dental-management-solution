import { Controller, type ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Authenticated, Public, RequirePermission, routeAccess } from './route-access';

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open(): void {}

  @Authenticated()
  @Get('mine')
  mine(): void {}

  @RequirePermission('tenant:write')
  @Get('guarded')
  guarded(): void {}

  @Get('undeclared')
  undeclared(): void {}
}

const reflector = new Reflector();
const target = (name: keyof ProbeController) =>
  ({
    getHandler: () => ProbeController.prototype[name],
    getClass: () => ProbeController,
  }) as unknown as ExecutionContext;

describe('route access metadata', () => {
  it('distinguishes public, authenticated-only and undeclared routes', () => {
    expect(routeAccess(reflector, target('open'))).toBe('public');
    expect(routeAccess(reflector, target('mine'))).toBe('authenticated');
    expect(routeAccess(reflector, target('guarded'))).toEqual({ permission: 'tenant:write' });
    expect(routeAccess(reflector, target('undeclared'))).toBeUndefined();
  });
});
