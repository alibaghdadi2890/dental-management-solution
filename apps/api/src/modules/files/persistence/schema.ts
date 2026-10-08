import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/**
 * A patient's images and documents (feature 8; ADR-0038 to ADR-0040). A row belongs to a patient
 * and, optionally, to a visit and a tooth; `patient_id` and `visit_id` have no foreign key —
 * `patients` and `clinical` own those tables (CLAUDE.md §4 rule 1).
 *
 * A row starts **pending** (`saved_at` null) when the browser asks where to upload, and becomes a
 * file at Save, which gives it its category and its "taken on". The bytes are in object storage
 * under `storage_key` (the original, never modified) and, when `has_preview`, beside it as
 * `display.jpg` and `thumb.jpg`. `orientation` is the stored rotation, applied on render.
 * `kind`, `category` and `sub_category` are text + Zod (`@dcm/contracts`). Archive is a soft
 * state; nothing is hard-deleted except pending rows that were never saved.
 */
export const files = pgTable(
  'files',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    visitId: uuid(),
    toothCode: text(),
    kind: text().notNull(),
    category: text(),
    subCategory: text(),
    /** When the image was taken: what the gallery sorts and groups by (F7). */
    takenAt: timestamp({ withTimezone: true }),
    note: text().notNull().default(''),
    originalFilename: text().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    mimeType: text().notNull(),
    storageKey: text().notNull(),
    hasPreview: boolean().notNull().default(false),
    orientation: smallint().notNull().default(0),
    /** The auth user id of whoever uploaded it. */
    uploadedBy: uuid().notNull(),
    /** "Uploaded at": when the batch was saved. Null while the upload is pending. */
    savedAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
    archivedBy: uuid(),
    archiveReason: text(),
    ...timestamps(),
  },
  (table) => [
    index('files_tenant_idx').on(table.tenantId),
    index('files_patient_taken_idx').on(table.tenantId, table.patientId, table.takenAt.desc()),
    check(
      'files_tooth_code_format',
      sql`${table.toothCode} is null or ${table.toothCode} ~ '^([1-4][1-8]|[5-8][1-5])$'`,
    ),
    check('files_orientation', sql`${table.orientation} in (0, 90, 180, 270)`),
    check(
      'files_saved_fields',
      sql`${table.savedAt} is null or (${table.category} is not null and ${table.takenAt} is not null)`,
    ),
    check(
      'files_archived_fields',
      sql`(${table.archivedAt} is null) = (${table.archivedBy} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);
