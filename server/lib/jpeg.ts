// A JPEG's EXIF orientation: a phone keeps a portrait photo's pixels sideways and says "turn me" in a
// tag. Viewers obey it; not everything that reads the pixels does (a model reading the page may get
// it sideways), so a converted photo is turned upright for real and the tag set back to 1.

/** How far a tag value asks to turn the picture clockwise; the mirrored values (2, 4, 5, 7) are left. */
export const TURN_FOR: Record<number, 90 | 180 | 270> = { 3: 180, 6: 90, 8: 270 };

type Found = { value: number; offset: number; littleEndian: boolean };

/** The orientation tag in a JPEG's EXIF block, and where its value sits; null when there is none. */
export function jpegOrientation(bytes: Uint8Array): Found | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker === 0xda || marker === 0xd9) return null; // the picture itself: no more headers
    const length = view.getUint16(at + 2);
    const isExif = marker === 0xe1 && at + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(at + 4, at + 10)) === 'Exif\0\0';
    if (isExif) return orientationIn(view, at + 10, Math.min(bytes.length, at + 2 + length));
    at += 2 + length;
  }
  return null;
}

function orientationIn(view: DataView, base: number, end: number): Found | null {
  if (base + 8 > end) return null;
  const order = view.getUint16(base);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const littleEndian = order === 0x4949;
  const ifd = base + view.getUint32(base + 4, littleEndian);
  if (ifd + 2 > end) return null;
  const entries = view.getUint16(ifd, littleEndian);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, littleEndian) === 0x0112) return { value: view.getUint16(entry + 8, littleEndian), offset: entry + 8, littleEndian };
  }
  return null;
}

/** Sets a JPEG's orientation tag in place; false when it has none to set. */
export function setJpegOrientation(bytes: Uint8Array, value: number): boolean {
  const found = jpegOrientation(bytes);
  if (!found) return false;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(found.offset, value, found.littleEndian);
  return true;
}
