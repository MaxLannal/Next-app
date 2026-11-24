import { describe, expect, it } from 'vitest';
import { jpegOrientation, setJpegOrientation, TURN_FOR } from './jpeg.ts';

/** A JPEG header with an EXIF block holding just an orientation tag, in either byte order. */
function jpegWith(orientation: number, littleEndian = false): Uint8Array {
  const tiff = new Uint8Array(26);
  const t = new DataView(tiff.buffer);
  t.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  t.setUint16(2, 42, littleEndian);
  t.setUint32(4, 8, littleEndian); // IFD0 right after the header
  t.setUint16(8, 1, littleEndian); // one entry
  t.setUint16(10, 0x0112, littleEndian);
  t.setUint16(12, 3, littleEndian); // SHORT
  t.setUint32(14, 1, littleEndian);
  t.setUint16(18, orientation, littleEndian);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  const a = new DataView(app1.buffer);
  a.setUint16(0, 0xffe1);
  a.setUint16(2, 2 + 6 + tiff.length);
  app1.set(new TextEncoder().encode('Exif\0\0'), 4);
  app1.set(tiff, 10);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0, 2]);
}

describe('JPEG orientation', () => {
  it('reads the tag a phone writes for a portrait photo kept sideways, in either byte order', () => {
    expect(jpegOrientation(jpegWith(6))?.value).toBe(6);
    expect(jpegOrientation(jpegWith(8, true))?.value).toBe(8);
    expect(TURN_FOR[6]).toBe(90);
    expect(TURN_FOR[1]).toBeUndefined();
  });

  it('sets it back to upright once the pixels are turned', () => {
    const bytes = jpegWith(6, true);
    expect(setJpegOrientation(bytes, 1)).toBe(true);
    expect(jpegOrientation(bytes)?.value).toBe(1);
  });

  it('finds nothing in a JPEG without EXIF, or in something that is not a JPEG', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(jpegOrientation(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(setJpegOrientation(new Uint8Array([0xff, 0xd8]), 1)).toBe(false);
  });
});
