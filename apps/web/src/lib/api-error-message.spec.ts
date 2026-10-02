import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { apiErrorMessage } from './api-error-message';

const i18n = i18next.createInstance();

const problem = (code: string, detail?: string) =>
  new ApiError({
    type: 'about:blank',
    title: 'Conflict',
    status: 409,
    code,
    ...(detail ? { detail } : {}),
  });

describe('apiErrorMessage', () => {
  beforeAll(async () => {
    await i18n.init({
      lng: 'fr',
      resources: {
        fr: {
          clinical: { errors: { visit: { stale: 'La visite a changé' } } },
          common: { unexpected: 'Erreur inattendue' },
        },
      },
    });
  });

  it('translates a known code', () => {
    expect(apiErrorMessage(problem('visit.stale', 'The visit changed'), i18n)).toBe(
      'La visite a changé',
    );
  });

  it("falls back to the server's text, then its title", () => {
    expect(apiErrorMessage(problem('visit.other', 'Server words'), i18n)).toBe('Server words');
    expect(apiErrorMessage(problem('visit.other'), i18n)).toBe('Conflict');
  });

  it('is generic for anything that is not a problem', () => {
    expect(apiErrorMessage(new Error('boom'), i18n)).toBe('Erreur inattendue');
  });
});
