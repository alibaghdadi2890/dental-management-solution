import { quadrant, type ToothCode, type ToothPresenceState } from '@dcm/contracts';

/**
 * How a tooth position that is not a plain natural tooth is drawn (feature 7, H1):
 *
 * - **missing**: a muted dashed outline with a small diagonal cross, at reduced opacity; no
 *   surfaces — there is nothing to treat a surface of;
 * - **not erupted**: a lighter dotted outline, no cross;
 * - **implant**: the tooth's normal glyph at full opacity (crowns and surfaces on it still
 *   read), inside a second, dark outline, with a post mark on the root side.
 *
 * None of the three relies on colour: outline style, the cross and the post tell them apart in
 * grayscale too, and from a tooth with nothing recorded (a plain solid outline).
 */

/** A missing or not-erupted position: nothing stands there. */
export type AbsentPresence = Extract<ToothPresenceState, 'missing' | 'not_erupted'>;

export function isAbsent(presence: ToothPresenceState): presence is AbsentPresence {
  return presence === 'missing' || presence === 'not_erupted';
}

/** The implant's second outline, drawn with `outline` so it composes with the selected and
 * planned rings (box shadows). */
export const IMPLANT_OUTLINE = 'outline outline-[1.5px] outline-offset-2 outline-ink';

/** Roots point away from the bite: up in the upper arch, down in the lower. */
export function rootSide(code: ToothCode): 'top' | 'bottom' {
  const q = quadrant(code);
  return q === 1 || q === 2 ? 'top' : 'bottom';
}
