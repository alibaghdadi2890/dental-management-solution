import {
  type ArchiveFilesInput,
  auditPageSchema,
  fileDownloadSchema,
  type PatientFile,
  type PatientFiles,
  patientFilesSchema,
  type SaveFilesInput,
  type UpdateFilesInput,
  type UploadIntent,
  uploadTargetSchema,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { activityKeys } from '@/features/audit/activity-api';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';

/**
 * `files` (feature 8). One read per patient — every file, archived ones included — that the
 * gallery, the visit strip, the tooth row, the Overview card and the quick view all derive from,
 * so one cache entry refreshes every surface. Keys are scoped under the acting tenant.
 */
export const fileKeys = {
  all: (tenantId: string | null) => ['files', tenantId] as const,
  patient: (tenantId: string | null, patientId: string) =>
    [...fileKeys.all(tenantId), 'patient', patientId] as const,
  history: (tenantId: string | null, fileId: string) =>
    [...fileKeys.all(tenantId), 'history', fileId] as const,
};

/**
 * Signed URLs live 15 minutes (F14). The list is read again every five, and a URL is kept for at
 * most five after it was signed: whenever one is used it is under ten minutes old, however the
 * refetches fall.
 */
const URL_REFRESH_MS = 5 * 60_000;

/**
 * A file's signed URLs change on every read. A thumbnail the browser already has is kept under
 * the URL it was loaded with while that URL is still good, so a refetch re-downloads nothing.
 */
const signed = new Map<
  string,
  { thumbnailUrl: string | null; viewUrl: string | null; at: number }
>();

function withStableUrls(files: PatientFile[], now: number): PatientFile[] {
  return files.map((file) => {
    const known = signed.get(file.id);
    if (known && now - known.at < URL_REFRESH_MS) {
      return { ...file, thumbnailUrl: known.thumbnailUrl, viewUrl: known.viewUrl };
    }
    signed.set(file.id, { thumbnailUrl: file.thumbnailUrl, viewUrl: file.viewUrl, at: now });
    return file;
  });
}

export function patientFilesQuery(patientId: string) {
  return queryOptions({
    queryKey: fileKeys.patient(actingTenantId(), patientId),
    queryFn: async () => {
      const { items } = await apiFetch(`/files?patientId=${patientId}`, patientFilesSchema);
      return withStableUrls(items, Date.now());
    },
    staleTime: 60_000,
    refetchInterval: URL_REFRESH_MS,
  });
}

/** The file's own rows of the audit log, newest first: the viewer's History (`audit:read`). */
export function fileHistoryQuery(fileId: string) {
  return queryOptions({
    queryKey: fileKeys.history(actingTenantId(), fileId),
    queryFn: () =>
      apiFetch(`/audit?resourceType=file&resourceId=${fileId}&limit=50`, auditPageSchema),
    staleTime: 0,
  });
}

export const requestUpload = (intent: UploadIntent) =>
  apiFetch('/files/uploads', uploadTargetSchema, { method: 'POST', json: intent });

export const discardUploads = (ids: readonly string[]) =>
  apiFetch(`/files/uploads?ids=${ids.join(',')}`, z.undefined(), { method: 'DELETE' });

export const saveFiles = (input: SaveFilesInput) =>
  apiFetch('/files', patientFilesSchema, { method: 'POST', json: input });

export const updateFiles = (input: UpdateFilesInput) =>
  apiFetch('/files', patientFilesSchema, { method: 'PATCH', json: input });

export const archiveFiles = (input: ArchiveFilesInput) =>
  apiFetch('/files/archive', patientFilesSchema, { method: 'POST', json: input });

export const restoreFiles = (ids: readonly string[]) =>
  apiFetch('/files/restore', patientFilesSchema, { method: 'POST', json: { ids } });

/** How long a download's hidden frame stays: long enough for the browser to take the response. */
const DOWNLOAD_FRAME_MS = 60_000;

/** Saves the original bytes under the original filename (F8): a short-lived signed URL whose
 * `Content-Disposition` makes it a download, not a page. */
export async function downloadFile(fileId: string): Promise<void> {
  const { url } = await apiFetch(`/files/${fileId}/download`, fileDownloadSchema);
  // A hidden frame per file: several downloads started together (the bulk bar) each go through,
  // where one navigation after another in the page would cancel the one before it.
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = url;
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
  }, DOWNLOAD_FRAME_MS);
}

/**
 * Sends bytes to a signed upload URL. `XMLHttpRequest`, not `fetch`: it reports progress, which
 * every tile shows (F2). Rejects on a network error, a refusal by the store, or an abort.
 */
export function putObject(
  url: string,
  body: Blob,
  contentType: string,
  options: { signal: AbortSignal; onProgress?: (fraction: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => {
      request.abort();
    };
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      options.signal.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Upload refused (${request.status})`));
    };
    request.onerror = () => {
      options.signal.removeEventListener('abort', abort);
      reject(new Error('Upload failed'));
    };
    request.onabort = () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    if (options.signal.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    options.signal.addEventListener('abort', abort, { once: true });
    request.send(body);
  });
}

/** Puts the files a mutation answered with into the patient's cached list, where each belongs. */
export function applyFiles(queryClient: QueryClient, changed: PatientFiles): void {
  const tenantId = actingTenantId();
  const now = Date.now();
  const byPatient = new Map<string, PatientFile[]>();
  for (const file of changed.items) {
    byPatient.set(file.patientId, [...(byPatient.get(file.patientId) ?? []), file]);
  }
  for (const [patientId, files] of byPatient) {
    queryClient.setQueryData<PatientFile[]>(fileKeys.patient(tenantId, patientId), (current) => {
      if (!current) return current;
      const fresh = new Map(withStableUrls(files, now).map((file) => [file.id, file]));
      const kept = current.map((file) => {
        const next = fresh.get(file.id);
        fresh.delete(file.id);
        return next ?? file;
      });
      return [...fresh.values(), ...kept].sort(
        (a, b) => b.takenAt.localeCompare(a.takenAt) || b.id.localeCompare(a.id),
      );
    });
  }
}

/** After a file changed: the patient's list (and its history), and the Activity feed. */
export async function invalidateFiles(queryClient: QueryClient, patientId: string): Promise<void> {
  const tenantId = actingTenantId();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: fileKeys.patient(tenantId, patientId) }),
    queryClient.invalidateQueries({ queryKey: [...fileKeys.all(tenantId), 'history'] }),
    queryClient.invalidateQueries({ queryKey: activityKeys.all(tenantId) }),
  ]);
}
