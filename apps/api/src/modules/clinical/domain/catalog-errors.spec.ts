import { describe, expect, it } from 'vitest';
import {
  CatalogItemInactiveError,
  CatalogItemInUseError,
  CatalogItemNotFoundError,
} from './catalog-errors';

/** `kind` decides the HTTP status (`platform/errors/problem-details.ts`); pinned as in
 * `visit-errors.spec.ts`. */
describe('catalog domain errors', () => {
  it.each([
    [new CatalogItemNotFoundError('x'), 'catalog.not_found', 'not_found'],
    [new CatalogItemInUseError('x'), 'catalog.in_use', 'conflict'],
    [new CatalogItemInactiveError('x'), 'catalog.inactive', 'invalid'],
  ])('%s carries code %s and kind %s', (error, code, kind) => {
    expect(error.code).toBe(code);
    expect(error.kind).toBe(kind);
  });
});
