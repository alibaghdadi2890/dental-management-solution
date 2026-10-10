/** How much of a stored object Save reads to check what it is. */
export const CONTENT_HEAD_BYTES = 1024;

/** HEIC and HEIF brands (ISO base media `ftyp`), still images and sequences. */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

const OOXML = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function startsWith(head: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => head[offset + index] === byte);
}

function textAt(head: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...head.subarray(offset, offset + length));
}

/**
 * Whether the first bytes of a stored object are what its accepted type says (F1): the type an
 * upload is stored and served with comes from its name, which the uploader chooses, so Save
 * checks the bytes themselves. Plain text has no signature: it must hold no NUL byte, unless it
 * opens with a UTF-16 byte order mark (Notepad's "Unicode"). A type that is not an accepted one
 * never matches. Pure.
 */
export function contentMatches(mimeType: string, head: Uint8Array): boolean {
  if (head.length === 0) return false;
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return textAt(head, 0, 4) === 'RIFF' && textAt(head, 8, 4) === 'WEBP';
    case 'image/heic':
    case 'image/heif':
      return textAt(head, 4, 4) === 'ftyp' && HEIF_BRANDS.has(textAt(head, 8, 4));
    case 'image/tiff':
      return (
        startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
      );
    case 'application/pdf':
      // Readers accept the header anywhere in the first 1024 bytes.
      return textAt(head, 0, CONTENT_HEAD_BYTES).includes('%PDF-');
    case 'text/plain':
      return startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff]) || !head.includes(0);
    default:
      return OOXML.has(mimeType) && startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
  }
}
