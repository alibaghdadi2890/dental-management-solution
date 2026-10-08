import { describe, expect, it } from 'vitest';
import { readExif } from './exif';

/**
 * A minimal JPEG: SOI, an APP0 segment (as cameras write before EXIF), then APP1 with a TIFF
 * block holding `Orientation` in IFD0 and `DateTimeOriginal` in the Exif IFD.
 */
function jpeg({
  little,
  orientation,
  takenAt,
}: {
  little: boolean;
  orientation?: number;
  takenAt?: string;
}): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(128));
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little);
  const entry = (at: number, tag: number, type: number, count: number) => {
    tiff.setUint16(at, tag, little);
    tiff.setUint16(at + 2, type, little);
    tiff.setUint32(at + 4, count, little);
  };
  // IFD0 at 8: two entries.
  tiff.setUint16(8, 2, little);
  entry(10, 0x0112, 3, 1);
  tiff.setUint16(18, orientation ?? 0, little);
  entry(22, 0x8769, 4, 1);
  tiff.setUint32(30, 40, little);
  // Exif IFD at 40: one entry, its text at 60.
  tiff.setUint16(40, 1, little);
  entry(42, 0x9003, 2, 20);
  tiff.setUint32(50, 60, little);
  const text = takenAt ?? '';
  for (let index = 0; index < text.length; index += 1) {
    tiff.setUint8(60 + index, text.charCodeAt(index));
  }

  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const size = 2 + exif.length + tiff.byteLength;
  const bytes = [
    0xff,
    0xd8,
    ...app0,
    0xff,
    0xe1,
    size >> 8,
    size & 0xff,
    ...exif,
    ...new Uint8Array(tiff.buffer),
    0xff,
    0xda,
    0x00,
    0x02,
  ];
  return new Uint8Array(bytes).buffer;
}

describe('readExif', () => {
  it.each([true, false])('reads orientation and the time taken (little endian: %s)', (little) => {
    expect(readExif(jpeg({ little, orientation: 6, takenAt: '2026:03:12 10:42:07' }))).toEqual({
      orientation: 6,
      takenAt: '2026-03-12T10:42:07',
    });
  });

  it('knows nothing of a zeroed date or an orientation outside 1–8', () => {
    expect(
      readExif(jpeg({ little: true, orientation: 9, takenAt: '0000:00:00 00:00:00' })),
    ).toEqual({ orientation: null, takenAt: null });
    expect(readExif(jpeg({ little: true }))).toEqual({ orientation: null, takenAt: null });
  });

  it('knows nothing of what is not a JPEG with EXIF', () => {
    const nothing = { orientation: null, takenAt: null };
    expect(readExif(new ArrayBuffer(0))).toEqual(nothing);
    // A PNG signature.
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer)).toEqual(nothing);
    // A JPEG that goes straight to its image data.
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer)).toEqual(nothing);
    // A truncated EXIF block.
    expect(readExif(jpeg({ little: true, orientation: 3 }).slice(0, 30))).toEqual(nothing);
  });
});
