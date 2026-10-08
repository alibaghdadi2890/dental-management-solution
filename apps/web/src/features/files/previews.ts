import { needsDecoder } from '@dcm/contracts';

/**
 * The display copy and the thumbnail of an image, made in the browser before upload (feature 8,
 * spec D3; ADR-0039). Drawing through a canvas is what makes them safe to show: the browser
 * turns the picture upright from its EXIF orientation (F8), and the JPEG it writes carries no
 * EXIF at all, GPS included (F14). The original is uploaded as it is.
 */
export interface Previews {
  display: Blob;
  thumbnail: Blob;
}

const DISPLAY_EDGE = 2560;
const THUMBNAIL_EDGE = 480;
const PREVIEW_TYPE = 'image/jpeg';

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** HEIC/HEIF: decoded by libheif (WebAssembly), loaded only when such a file arrives. */
async function decodeHeic(file: Blob): Promise<Drawable> {
  const { heicTo } = await import('heic-to');
  const bitmap = await heicTo({ blob: file, type: 'bitmap' });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => {
      bitmap.close();
    },
  };
}

/** TIFF: the first image of the file, as RGBA. */
async function decodeTiff(file: Blob): Promise<Drawable> {
  const UTIF = await import('utif2');
  const buffer = await file.arrayBuffer();
  const [ifd] = UTIF.decode(buffer);
  if (!ifd) throw new Error('Empty TIFF');
  UTIF.decodeImage(buffer, ifd);
  const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
  const canvas = document.createElement('canvas');
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  context.putImageData(new ImageData(rgba, ifd.width, ifd.height), 0, 0);
  return { source: canvas, width: ifd.width, height: ifd.height, close: () => undefined };
}

async function decode(file: Blob, mimeType: string): Promise<Drawable> {
  const decoder = needsDecoder(mimeType);
  if (decoder === 'heic') return decodeHeic(file);
  if (decoder === 'tiff') return decodeTiff(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => {
      bitmap.close();
    },
  };
}

function render(image: Drawable, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('No canvas'));
  // JPEG has no alpha: a transparent PNG gets a white ground, not a black one.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode the preview'));
      },
      PREVIEW_TYPE,
      quality,
    );
  });
}

/**
 * Null when the browser cannot decode the image: the file is then uploaded without previews and
 * shows as a typed tile with Download.
 */
export async function makePreviews(file: Blob, mimeType: string): Promise<Previews | null> {
  let image: Drawable;
  try {
    image = await decode(file, mimeType);
  } catch {
    return null;
  }
  try {
    const [display, thumbnail] = await Promise.all([
      render(image, DISPLAY_EDGE, 0.9),
      render(image, THUMBNAIL_EDGE, 0.8),
    ]);
    return { display, thumbnail };
  } catch {
    return null;
  } finally {
    image.close();
  }
}
