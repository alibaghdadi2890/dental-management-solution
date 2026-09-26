/** No look-alikes (0/O, 1/l/I) so a password read aloud or copied by hand survives. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * A temporary password for a new account (D6), e.g. `Kp7r-Wm2x-9tQa`: 12 random characters from a
 * 56-symbol alphabet (~70 bits) in hyphenated groups. Satisfies the password policy; the user
 * replaces it at first sign-in.
 */
export function generateTemporaryPassword(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group++) {
    let chunk = '';
    while (chunk.length < GROUP_LENGTH) {
      const [byte = 0] = random(new Uint8Array(1));
      // Rejection sampling keeps every symbol equally likely.
      if (byte < 256 - (256 % ALPHABET.length)) {
        chunk += ALPHABET.charAt(byte % ALPHABET.length);
      }
    }
    groups.push(chunk);
  }
  return groups.join('-');
}
