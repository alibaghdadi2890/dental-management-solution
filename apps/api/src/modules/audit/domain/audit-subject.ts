import { idSchema } from '@dcm/contracts';

/** The patient and the visit an audit row is about (feature 7, H7; ADR-0037). */
export interface AuditSubject {
  patientId?: string | undefined;
  visitId?: string | undefined;
}

function idAt(snapshot: unknown, key: 'patientId' | 'visitId'): string | undefined {
  if (snapshot === null || typeof snapshot !== 'object') return undefined;
  const parsed = idSchema.safeParse((snapshot as Record<string, unknown>)[key]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a row is about, most explicit first: what the caller said, what the surrounding work is
 * about (`AuditService.about`), the resource itself when it is a patient or a visit, then the
 * `patientId` / `visitId` its snapshots carry. Pure.
 */
export function subjectOf(
  entry: {
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
    patientId?: string | undefined;
    visitId?: string | undefined;
  },
  ambient: AuditSubject,
): { patientId: string | null; visitId: string | null } {
  const own = (type: string) => (entry.resourceType === type ? entry.resourceId : undefined);
  return {
    patientId:
      entry.patientId ??
      ambient.patientId ??
      own('patient') ??
      idAt(entry.after, 'patientId') ??
      idAt(entry.before, 'patientId') ??
      null,
    visitId:
      entry.visitId ??
      ambient.visitId ??
      own('visit') ??
      idAt(entry.after, 'visitId') ??
      idAt(entry.before, 'visitId') ??
      null,
  };
}
