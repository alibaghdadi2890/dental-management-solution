import { describe, expect, it } from 'vitest';
import { contentMatches } from './content-check';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('contentMatches', () => {
  it.each([
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)],
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)],
    ['image/webp', join(ascii('RIFF'), bytes(1, 2, 3, 4), ascii('WEBPVP8 '))],
    ['image/heic', join(bytes(0, 0, 0, 0x18), ascii('ftypheic'))],
    ['image/heif', join(bytes(0, 0, 0, 0x18), ascii('ftypmif1'))],
    ['image/tiff', bytes(0x49, 0x49, 0x2a, 0x00, 0x08)],
    ['image/tiff', bytes(0x4d, 0x4d, 0x00, 0x2a, 0x00)],
    ['application/pdf', ascii('%PDF-1.7\n')],
    // A PDF may open with a little junk before its header.
    ['application/pdf', join(bytes(0xef, 0xbb, 0xbf, 0x0a), ascii('%PDF-1.4'))],
    [DOCX, bytes(0x50, 0x4b, 0x03, 0x04, 0x14)],
    [XLSX, bytes(0x50, 0x4b, 0x03, 0x04, 0x14)],
    ['text/plain', ascii('Referral: please see the attached.\r\n')],
    ['text/plain', bytes(0xd9, 0x85, 0xd8, 0xb1, 0xd8, 0xad, 0xd8, 0xa8, 0xd8, 0xa7)],
    // UTF-16 text is full of NUL bytes; its byte order mark says what it is.
    ['text/plain', bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00)],
    ['text/plain', bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69)],
  ])('accepts %s content', (mimeType, head) => {
    expect(contentMatches(mimeType, head)).toBe(true);
  });

  it.each([
    ['image/jpeg', ascii('<html><script>alert(1)</script></html>')],
    ['image/png', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/webp', join(ascii('RIFF'), bytes(1, 2, 3, 4), ascii('AVI LIST'))],
    ['image/heic', join(bytes(0, 0, 0, 0x18), ascii('ftypisom'))],
    ['image/tiff', bytes(0x49, 0x49, 0x00, 0x2a)],
    ['application/pdf', ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    [DOCX, ascii('MZ\u0090\u0000')],
    // A binary passed off as text.
    ['text/plain', bytes(0x4d, 0x5a, 0x90, 0x00, 0x03)],
    ['image/jpeg', bytes()],
    ['video/mp4', join(bytes(0, 0, 0, 0x18), ascii('ftypisom'))],
  ])('refuses content that is not %s', (mimeType, head) => {
    expect(contentMatches(mimeType, head)).toBe(false);
  });
});
