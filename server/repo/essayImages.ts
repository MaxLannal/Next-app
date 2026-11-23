import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context.ts';

/** Images pasted into an essay: stored in `files/essay-images/` and served back by name. */
const FOLDER = 'essay-images';

// Raster only: no SVG or HTML, so an upload can never run script on the hub's origin.
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const NAME = /^[A-Za-z0-9-]+\.(jpg|png|gif|webp)$/;

export const MAX_ESSAY_IMAGE_BYTES = 20 * 1024 * 1024;

/** The name for an image of this type, or null when the type isn't stored. */
export function essayImageName(mime: string): string | null {
  const ext = EXTENSIONS[mime.toLowerCase()];
  return ext ? `${randomUUID()}.${ext}` : null;
}

export function storeEssayImage(ctx: AppContext, name: string, bytes: Buffer): string {
  const dir = join(ctx.paths.filesDir, FOLDER);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
  return `/api/essay-images/${name}`;
}

/**
 * The image at a name from a URL, or null if the name isn't one we made. An
 * encoded name is decoded first, and `/` or `\` still fails the pattern, so no name is a path.
 */
export function readEssayImage(ctx: AppContext, raw: string): { bytes: Buffer; mime: string } | null {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // A malformed escape stays as it is, and so fails the pattern.
  }
  if (!NAME.test(name)) return null;
  const ext = name.slice(name.lastIndexOf('.') + 1);
  const mime = Object.keys(EXTENSIONS).find((type) => EXTENSIONS[type] === ext);
  if (!mime) return null;
  try {
    return { bytes: readFileSync(join(ctx.paths.filesDir, FOLDER, name)), mime };
  } catch {
    return null;
  }
}
