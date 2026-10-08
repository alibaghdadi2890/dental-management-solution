/**
 * The two EXIF facts the upload flow needs from a JPEG (feature 8, F7, F8): when the picture was
 * taken (`DateTimeOriginal`) and how the camera was held (`Orientation`). Pure: bytes in, facts
 * out. Anything that is not a JPEG with a well-formed EXIF block reads as "nothing known".
 */
export interface ExifFacts {
  /** 1–8 as EXIF defines it (1 = upright), or null. */
  orientation: number | null;
  /** `YYYY-MM-DDTHH:mm:ss`, the camera's wall-clock time (EXIF carries no time zone), or null. */
  takenAt: string | null;
}

const NOTHING: ExifFacts = { orientation: null, takenAt: null };

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const DATE_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

/** How much of a file holds its EXIF block: it sits right after the JPEG header. */
export const EXIF_PROBE_BYTES = 256 * 1024;

interface Tiff {
  view: DataView;
  /** Where the TIFF header starts: every offset inside the block counts from here. */
  base: number;
  little: boolean;
}

function entries(
  tiff: Tiff,
  ifd: number,
): { tag: number; type: number; count: number; at: number }[] {
  const { view, base, little } = tiff;
  const start = base + ifd;
  if (start + 2 > view.byteLength) return [];
  const count = view.getUint16(start, little);
  const found = [];
  for (let index = 0; index < count; index += 1) {
    const at = start + 2 + index * 12;
    if (at + 12 > view.byteLength) break;
    found.push({
      tag: view.getUint16(at, little),
      type: view.getUint16(at + 2, little),
      count: view.getUint32(at + 4, little),
      at,
    });
  }
  return found;
}

function ascii(tiff: Tiff, entry: { count: number; at: number }): string | null {
  const { view, base, little } = tiff;
  const start = entry.count <= 4 ? entry.at + 8 : base + view.getUint32(entry.at + 8, little);
  if (start + entry.count > view.byteLength) return null;
  let text = '';
  for (let index = 0; index < entry.count; index += 1) {
    const code = view.getUint8(start + index);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function readTiff(tiff: Tiff): ExifFacts {
  const { view, base, little } = tiff;
  if (base + 8 > view.byteLength || view.getUint16(base + 2, little) !== 42) return NOTHING;
  const root = entries(tiff, view.getUint32(base + 4, little));
  const orientationEntry = root.find(
    (entry) => entry.tag === TAG_ORIENTATION && entry.type === TYPE_SHORT,
  );
  const value = orientationEntry ? view.getUint16(orientationEntry.at + 8, little) : null;
  const orientation = value !== null && value >= 1 && value <= 8 ? value : null;

  const pointer = root.find((entry) => entry.tag === TAG_EXIF_IFD);
  const dateEntry = pointer
    ? entries(tiff, view.getUint32(pointer.at + 8, little)).find(
        (entry) => entry.tag === TAG_DATE_TIME_ORIGINAL && entry.type === TYPE_ASCII,
      )
    : undefined;
  const match = dateEntry ? DATE_TIME.exec(ascii(tiff, dateEntry) ?? '') : null;
  const takenAt =
    match && match[1] !== '0000'
      ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`
      : null;
  return { orientation, takenAt };
}

/** Reads the EXIF block of a JPEG's first bytes. Never throws. */
export function readExif(buffer: ArrayBuffer): ExifFacts {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return NOTHING;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return NOTHING;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    // Start of scan: the metadata segments are behind us.
    if (marker === 0xda || size < 2) return NOTHING;
    const body = offset + 4;
    // APP1 holding "Exif\0\0", then a TIFF block.
    if (
      marker === 0xe1 &&
      body + 14 <= view.byteLength &&
      view.getUint32(body) === 0x45786966 &&
      view.getUint16(body + 4) === 0
    ) {
      const base = body + 6;
      const order = view.getUint16(base);
      if (order !== 0x4949 && order !== 0x4d4d) return NOTHING;
      return readTiff({ view, base, little: order === 0x4949 });
    }
    offset += 2 + size;
  }
  return NOTHING;
}

/** The EXIF facts of an uploaded file; nothing for anything but a JPEG. */
export async function exifOf(file: Blob, mimeType: string): Promise<ExifFacts> {
  if (mimeType !== 'image/jpeg') return NOTHING;
  try {
    return readExif(await file.slice(0, EXIF_PROBE_BYTES).arrayBuffer());
  } catch {
    return NOTHING;
  }
}
