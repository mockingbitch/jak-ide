// Attaching images to a chat turn (Cursor-style): read a File into a base64 image
// the backend forwards to Claude as a multimodal content block.

export interface AttachedImage {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string; // image/png | image/jpeg | image/gif | image/webp
  readonly dataBase64: string; // no data: prefix
  readonly previewUrl: string; // full data: URL for the thumbnail
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB per image
// Media types Claude accepts; anything else is sent as png (best effort).
const SUPPORTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const isImageFile = (f: File): boolean => f.type.startsWith('image/');

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
}

/** Convert an image File to an AttachedImage, or throw with a user-facing message. */
export async function fileToImage(file: File): Promise<AttachedImage> {
  if (!isImageFile(file)) throw new Error(`${file.name || 'File'} is not an image`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name || 'Image'} is larger than 5MB`);
  const dataUrl = await readDataUrl(file);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Could not read the image');
  const mediaType = SUPPORTED.includes(file.type) ? file.type : 'image/png';
  return {
    id: crypto.randomUUID(),
    name: file.name || 'image',
    mediaType,
    dataBase64: dataUrl.slice(comma + 1),
    previewUrl: dataUrl,
  };
}

/** Pull image files out of a paste/drop DataTransfer. */
export function imagesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.files)) {
    if (isImageFile(item)) out.push(item);
  }
  return out;
}
