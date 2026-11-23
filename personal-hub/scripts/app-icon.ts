// The Next app icon: the logo from shared/next-mark.ts on Apple's 1024 px icon canvas.
// scripts/make-icon.sh rasterises it with sips and packs AppIcon.icns.
//   node scripts/app-icon.ts > icon.svg
import { nextMarkSvg } from '../shared/next-mark.ts';

/**
 * The tile keeps Apple's icon corner (185.4 px on the 824 px tile, here in the drawing's units),
 * not the drawing's rounder one: macOS 26 sets an icon whose outline isn't its own app shape
 * inside a grey tile.
 */
const APPLE_CORNER = 185.4 * (284 / 824);

export const appIconSvg = (): string => nextMarkSvg({ frame: 'icon', tileRadius: APPLE_CORNER });

if (import.meta.main) process.stdout.write(appIconSvg());
