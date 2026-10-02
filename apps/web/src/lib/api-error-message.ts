import type { i18n as I18n } from 'i18next';
import { ApiError } from './api';

/** Where a problem code's translation may live, most specific first (`<namespace>:errors.<code>`,
 * the code's dots nesting the keys: `visit.stale` → `errors.visit.stale`). */
const NAMESPACES = ['clinical', 'patients', 'billing', 'common'] as const;

/**
 * The message to show for a failed call: the translation of its stable problem `code` when the
 * UI language has one, else the server's own text, else the generic "Something went wrong".
 * Server texts are English; codes are the contract (CLAUDE.md §12).
 */
export function apiErrorMessage(error: unknown, i18n: I18n): string {
  if (error instanceof ApiError) {
    // The key is built at run time, so it can't be one of the typed resource keys.
    const translate = i18n.t.bind(i18n) as (key: string) => string;
    for (const namespace of NAMESPACES) {
      const key = `${namespace}:errors.${error.code}`;
      if (i18n.exists(key)) return translate(key);
    }
    return error.problem.detail ?? error.problem.title;
  }
  return i18n.t('common:unexpected');
}
