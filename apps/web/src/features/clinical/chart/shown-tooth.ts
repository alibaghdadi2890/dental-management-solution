import {
  type DentitionStage,
  isPrimary,
  positionKey,
  presentTooth,
  type ToothCode,
  type ToothPresence,
} from '@dcm/contracts';

/**
 * The tooth the chart shows in `code`'s position (`presentTooth` over the dentition and the
 * position's presence record, W5): `code` itself, or the other tooth of the position — a
 * primary tooth's successor once it has come through, a permanent tooth's predecessor while it
 * is still there. Only the tooth shown can be selected and charted.
 */
export function shownTooth(
  code: ToothCode,
  dentition: DentitionStage,
  toothStatus: readonly ToothPresence[],
): ToothCode {
  const column = positionKey(code);
  // `positionKey` is always a permanent code; the guard only narrows its type.
  if (isPrimary(column)) return code;
  const presence = toothStatus.find((record) => record.position === column)?.present;
  return presentTooth(column, dentition, presence).code;
}
