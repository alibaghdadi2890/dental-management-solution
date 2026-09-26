import { ClsServiceManager } from 'nestjs-cls';
import type { AppClsStore } from '../cls/app-cls-store';

/** pino mixin: every log line carries requestId, tenantId and userId from CLS (CLAUDE.md §15). */
export function clsLogFields(): Record<string, string | undefined> {
  const cls = ClsServiceManager.getClsService<AppClsStore>();
  if (!cls.isActive()) {
    return {};
  }
  return { requestId: cls.getId(), tenantId: cls.get('tenantId'), userId: cls.get('userId') };
}

/**
 * Defence in depth: code must log ids, never PII. These paths are censored if it slips through.
 */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.email',
  '*.phone',
  '*.dateOfBirth',
  '*.notes',
];

/** Drops the query string: search terms are often patient names. */
export function pathOnly(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}
