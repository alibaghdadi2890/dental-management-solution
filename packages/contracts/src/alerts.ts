import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { visitStatusSchema } from './visits.js';

/** A checked-in patient waiting for one of the caller's dentists (feature 15). */
export const alertWaitingSchema = z.object({
  appointmentId: idSchema,
  patientId: idSchema,
  patientName: z.string(),
  dentistId: idSchema,
  dentistName: z.string(),
  roomName: z.string().nullable(),
  startsAt: isoDateTimeSchema,
  checkedInAt: isoDateTimeSchema,
});
export type AlertWaiting = z.infer<typeof alertWaitingSchema>;

/** A live visit of one of the caller's dentists, with who started it (feature 15). */
export const alertInRoomSchema = z.object({
  visitId: idSchema,
  patientId: idSchema,
  patientName: z.string(),
  dentistId: idSchema,
  dentistName: z.string(),
  roomName: z.string().nullable(),
  status: visitStatusSchema,
  startedAt: isoDateTimeSchema,
  pausedAt: isoDateTimeSchema.nullable(),
  pausedSeconds: z.number().int().nonnegative(),
  /** The auth user id: the caller's own starts never alert. */
  startedBy: idSchema,
  startedByName: z.string(),
});
export type AlertInRoom = z.infer<typeof alertInRoomSchema>;

/**
 * `GET /alerts/tray`: "Your patients", derived from what `scheduling` and `clinical` hold (D5).
 * The caller's dentists are their own staff profile, when they practise, and those they follow.
 */
export const alertTraySchema = z.object({
  waiting: z.array(alertWaitingSchema),
  inRoom: z.array(alertInRoomSchema),
  /** The dentists the caller follows (staff profile ids). */
  follows: z.array(idSchema),
  /** So the tray can run the visit timers from an offset, like `Visit.serverNow`. */
  serverNow: isoDateTimeSchema,
});
export type AlertTray = z.infer<typeof alertTraySchema>;

/** How many dentists one person may follow. */
export const MAX_ALERT_FOLLOWS = 50;

/** `PUT /alerts/follows`: the whole set; an empty one follows nobody. */
export const alertFollowsInputSchema = z.object({
  dentistIds: z
    .array(idSchema)
    .max(MAX_ALERT_FOLLOWS)
    .transform((ids) => [...new Set(ids)]),
});
export type AlertFollowsInput = z.infer<typeof alertFollowsInputSchema>;

/** The alert stream's one event (`GET /alerts/stream`): the tray may have changed (D6). */
export const ALERT_TRAY_EVENT = 'tray';

/** An item of the tray that alerts once: a patient arrived, or a visit started. */
export type AlertKey = `arrived:${string}` | `started:${string}`;
