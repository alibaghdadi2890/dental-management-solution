import type { FileCategory, PatientFile, ToothCode } from '@dcm/contracts';
import { todayIn } from '@/lib/format';

/**
 * What the gallery, the visit strip, the tooth row and the cards show of a patient's files
 * (feature 8): filters, the "taken on" groups, and the slices each surface takes. Pure — every
 * surface reads the same list (`patientFilesQuery`).
 */
export type CategoryFilter = 'all' | FileCategory | 'documents';

export interface GalleryFilter {
  category: CategoryFilter;
  /** `''` is any type. */
  subCategory: string;
  toothCode: ToothCode | null;
  /** `''` is any visit. */
  visitId: string;
  showArchived: boolean;
  q: string;
}

export const NO_FILTER: GalleryFilter = {
  category: 'all',
  subCategory: '',
  toothCode: null,
  visitId: '',
  showArchived: false,
  q: '',
};

/** Anything "Clear filters" would undo. */
export function isFiltered(filter: GalleryFilter): boolean {
  return (Object.keys(NO_FILTER) as (keyof GalleryFilter)[]).some(
    (field) => filter[field] !== NO_FILTER[field],
  );
}

export const isArchived = (file: PatientFile) => file.archivedAt !== null;

/** Not archived: what every surface but the gallery's "Show archived" shows. */
export function activeFiles(files: readonly PatientFile[]): PatientFile[] {
  return files.filter((file) => !isArchived(file));
}

export function filterFiles(files: readonly PatientFile[], filter: GalleryFilter): PatientFile[] {
  const needle = filter.q.trim().toLocaleLowerCase();
  return files.filter((file) => {
    if (!filter.showArchived && isArchived(file)) return false;
    if (filter.category === 'documents' ? file.kind !== 'document' : false) return false;
    if (
      filter.category !== 'all' &&
      filter.category !== 'documents' &&
      file.category !== filter.category
    ) {
      return false;
    }
    if (filter.subCategory !== '' && file.subCategory !== filter.subCategory) return false;
    if (filter.toothCode !== null && file.toothCode !== filter.toothCode) return false;
    if (filter.visitId !== '' && file.visitId !== filter.visitId) return false;
    return (
      needle === '' ||
      file.note.toLocaleLowerCase().includes(needle) ||
      file.originalFilename.toLocaleLowerCase().includes(needle)
    );
  });
}

export type TakenGroup =
  { kind: 'today' | 'yesterday' | 'week' } | { kind: 'month'; year: number; month: number };

export interface FileGroup {
  /** Stable across renders: `today`, `yesterday`, `week`, or `YYYY-MM`. */
  key: string;
  group: TakenGroup;
  files: PatientFile[];
}

const DAY_MS = 86_400_000;

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** The clinic's calendar date a file was taken on. */
export function takenOn(file: PatientFile, timeZone: string): string {
  return todayIn(timeZone, new Date(file.takenAt));
}

/**
 * Groups files — already newest first — by when they were taken, as the gallery heads them
 * (Today · Yesterday · This week · then a month and its year), in the clinic's time zone.
 */
export function groupByTaken(
  files: readonly PatientFile[],
  today: string,
  timeZone: string,
): FileGroup[] {
  const yesterday = daysBefore(today, 1);
  const weekStart = daysBefore(today, 6);
  const groups: FileGroup[] = [];
  for (const file of files) {
    const date = takenOn(file, timeZone);
    const group: TakenGroup =
      date === today
        ? { kind: 'today' }
        : date === yesterday
          ? { kind: 'yesterday' }
          : date >= weekStart && date < yesterday
            ? { kind: 'week' }
            : { kind: 'month', year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
    const key = group.kind === 'month' ? date.slice(0, 7) : group.kind;
    const last = groups.at(-1);
    if (last?.key === key) last.files.push(file);
    else groups.push({ key, group, files: [file] });
  }
  return groups;
}

/** The files linked to a visit, newest first: the strip's "This visit". */
export function visitFiles(files: readonly PatientFile[], visitId: string): PatientFile[] {
  return activeFiles(files)
    .filter((file) => file.visitId === visitId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export const RECENT_DAYS = 90;
export const RECENT_MAX = 12;

/** The patient's other files taken in the last 90 days, at most 12: the strip's "Recent". */
export function recentOtherFiles(
  files: readonly PatientFile[],
  visitId: string,
  now: Date,
): PatientFile[] {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  return activeFiles(files)
    .filter((file) => file.visitId !== visitId && file.takenAt >= since)
    .slice(0, RECENT_MAX);
}

/** A tooth's images: the tooth panel's row and its "2 images" count. */
export function toothImages(files: readonly PatientFile[], toothCode: ToothCode): PatientFile[] {
  return activeFiles(files).filter((file) => file.toothCode === toothCode && file.kind === 'image');
}

/** The visits the patient's files are linked to, newest first: the Visit filter's options. */
export function linkedVisits(files: readonly PatientFile[]) {
  const visits = new Map<string, NonNullable<PatientFile['visit']>>();
  for (const file of files) {
    if (file.visit) visits.set(file.visit.id, file.visit);
  }
  return [...visits.values()].sort((a, b) => b.displayNumber - a.displayNumber);
}
