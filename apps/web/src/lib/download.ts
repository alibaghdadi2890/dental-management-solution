import { actingTenantId } from '@/features/platform/acting-tenant';
import { API_BASE, TENANT_HEADER, toApiError } from './api';

const CONTENT_DISPOSITION_FILENAME = /filename="?([^";]+)"?/i;

function filenameFrom(contentDisposition: string | null, fallback: string): string {
  const match = contentDisposition ? CONTENT_DISPOSITION_FILENAME.exec(contentDisposition) : null;
  return match?.[1] ?? fallback;
}

/** Saves a blob the same way a plain `<a download>` click would — the one place this SPA triggers
 * a browser file save, kept tiny so a test can stub `URL.createObjectURL`/`revokeObjectURL` and
 * the anchor's `click()` without touching the request logic above it. The anchor is briefly
 * attached to the document (Firefox ignores `download` on a detached element) and the object URL
 * is revoked a macrotask later, not synchronously (Firefox can also drop the download if the URL
 * is revoked before it's had a turn to actually start reading it). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Downloads a CSV export (`path` with its query string, under the API base) and saves it under the
 * server's file name. A manual `fetch`, not `apiFetch` — the body is a file, not JSON — but with
 * every other convention it enforces: the session cookie, the acting tenant header, and a typed
 * `ApiError` on failure.
 */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const headers = new Headers({ Accept: 'text/csv' });
  const tenantId = actingTenantId();
  if (tenantId) headers.set(TENANT_HEADER, tenantId);
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', headers });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const blob = await response.blob();
  saveBlob(blob, filenameFrom(response.headers.get('content-disposition'), fallbackName));
}
