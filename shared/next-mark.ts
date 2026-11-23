// The Next logo as an SVG: a charcoal tile holding a champagne-silver plate, a dark lens laid across
// the plate at 45°, and a white ribbon that rounds both ends of the lens and runs down through its
// middle. The app icon (scripts/app-icon.ts) and the side rail's mark both draw it from here.
//
// Measurements are in the units of the reference drawing, whose tile is 284 across. K scales them
// onto Apple's 1024 px icon canvas: an 824 px tile, centred, with room around it for the shadow.

type Point = readonly [number, number];

export type NextMarkOptions = {
  /** The tile's corner, in the drawing's units. Defaults to the drawing's own. */
  tileRadius?: number;
  /** Degrees per wedge of the plate's shading: 1 for the app icon, coarser where it is drawn small. */
  sweepStep?: number;
  /** `icon` is Apple's 1024 px canvas with room round the tile for a shadow; `mark` is the tile alone. */
  frame?: 'icon' | 'mark';
};

const K = 824 / 284;
const CENTRE = 512;

/** The tile's corner as drawn. */
export const DRAWING_TILE_RADIUS = 90;
const TILE_HALF = 142;
const PLATE = { half: 110.5, radius: 52 };
/** The dark lens: semi-axes along and across its long axis, which runs down to the right. */
const LENS = { a: 111.5, b: 63, angle: 45 };
/**
 * The ribbon's inner edge lies on the lens. Its centreline leaves the lens's outline just past the
 * top-left tip (`leaveAt`, degrees round the ellipse) and bends through the centre `tilt` degrees
 * off vertical; `pull` and `push` are the two Bézier handle lengths. Each leg fades out between
 * `fadeFrom` and `solidFrom` degrees, where the plate beside it is nearly as white as it is.
 */
const RIBBON = { width: 19.5, leaveAt: 183, pull: 20, push: 110, tilt: 7.5, fadeFrom: 100, solidFrom: 112 };

/**
 * The plate's shading: grey by screen angle (degrees clockwise from 3 o'clock) folded into a half
 * turn, so the two halves match. Just past each tip of the lens it is as dark as the tile; it
 * brightens to near white a hundred degrees on. The jump from white back to dark sits at
 * `SWEEP_START`, where the ribbon comes closest to the tile and hides it.
 */
const SWEEP_START = 23;
const SWEEP: readonly Point[] = [
  [23, 58], [45, 62], [57, 92], [65, 106], [75, 120], [80, 130], [90, 147], [100, 167], [110, 185],
  [120, 203], [130, 219], [140, 231], [150, 237], [160, 239], [170, 242], [180, 243], [203, 245],
];

const TILE_GREY = '#3b3b3b';

const rad = (deg: number) => (deg * Math.PI) / 180;
const scale = (v: number) => +(v * K).toFixed(2);
const place = (v: number) => +(CENTRE + v * K).toFixed(2);
const xy = ([x, y]: Point) => `${place(x)} ${place(y)}`;

/** The plate's grey at a screen angle, 0–255. */
export function sweepGrey(deg: number): number {
  const d = ((((deg - SWEEP_START) % 180) + 180) % 180) + SWEEP_START;
  for (let i = 1; i < SWEEP.length; i++) {
    const [d1, g1] = SWEEP[i]!;
    if (d <= d1) {
      const [d0, g0] = SWEEP[i - 1]!;
      return g0 + ((g1 - g0) * (d - d0)) / (d1 - d0);
    }
  }
  return SWEEP[SWEEP.length - 1]![1];
}

/** A grey with the darker end leaning warm, like brushed champagne; the light end stays neutral. */
function champagne(g: number): string {
  const warm = Math.max(0, (225 - g) / 130);
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${hex(g + 2 * warm)}${hex(g - warm)}${hex(g - 10 * warm)}`;
}

// The ribbon's centreline ellipse: the lens grown by half the ribbon, so its inner edge is the lens.
const tilt = rad(LENS.angle);
const ca = LENS.a + RIBBON.width / 2;
const cb = LENS.b + RIBBON.width / 2;

function onCentreline(phiDeg: number): Point {
  const u = ca * Math.cos(rad(phiDeg));
  const v = cb * Math.sin(rad(phiDeg));
  return [u * Math.cos(tilt) - v * Math.sin(tilt), u * Math.sin(tilt) + v * Math.cos(tilt)];
}

function tangent(phiDeg: number): Point {
  const du = -ca * Math.sin(rad(phiDeg));
  const dv = cb * Math.cos(rad(phiDeg));
  const x = du * Math.cos(tilt) - dv * Math.sin(tilt);
  const y = du * Math.sin(tilt) + dv * Math.cos(tilt);
  const n = Math.hypot(x, y);
  return [x / n, y / n];
}

/** An arc along the centreline ellipse; `clockwise` is the way round the screen. */
const arcTo = (phiDeg: number, clockwise: boolean) =>
  `A ${scale(ca)} ${scale(cb)} ${LENS.angle} 0 ${clockwise ? 1 : 0} ${xy(onCentreline(phiDeg))}`;

/**
 * The ribbon, point-symmetric about the centre: up the left side, round the top-left tip, down
 * through the centre, round the bottom-right tip and up the right side.
 */
function ribbonPath(): string {
  const leave = onCentreline(RIBBON.leaveAt);
  const t = tangent(RIBBON.leaveAt);
  const bend: Point = [Math.sin(rad(RIBBON.tilt)), Math.cos(rad(RIBBON.tilt))];
  const h1: Point = [leave[0] + RIBBON.pull * t[0], leave[1] + RIBBON.pull * t[1]];
  const h2: Point = [-RIBBON.push * bend[0], -RIBBON.push * bend[1]];
  return [
    `M ${xy(onCentreline(RIBBON.solidFrom))}`,
    arcTo(RIBBON.leaveAt, true),
    `C ${xy(h1)} ${xy(h2)} ${xy([0, 0])}`,
    `C ${xy([-h2[0], -h2[1]])} ${xy([-h1[0], -h1[1]])} ${xy([-leave[0], -leave[1]])}`,
    arcTo(RIBBON.solidFrom - 180, false),
  ].join(' ');
}

/** One leg's fading end, as a path and the gradient that fades it, `turn` 0 or 180 degrees round. */
function legEnd(id: string, turn: number): { path: string; gradient: string } {
  const from = onCentreline(RIBBON.fadeFrom - turn);
  const solid = onCentreline(RIBBON.solidFrom - turn);
  return {
    path: `<path d="M ${xy(from)} ${arcTo(RIBBON.solidFrom + 2 - turn, true)}" fill="none" stroke="url(#${id})" stroke-width="${scale(RIBBON.width)}"/>`,
    gradient:
      `<linearGradient id="${id}" x1="${place(from[0])}" y1="${place(from[1])}" x2="${place(solid[0])}" y2="${place(solid[1])}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="#f3f3f3" stop-opacity="0"/><stop offset="1" stop-color="#f3f3f3"/></linearGradient>`,
  };
}

/**
 * The plate's shading as thin overlapping wedges round the centre, `step` degrees each: SVG has no
 * conic gradient. They overlap a little so no seam shows between them.
 */
function sweepWedges(step: number): string {
  const reach = 600;
  const corner = (deg: number) => `${(CENTRE + reach * Math.cos(rad(deg))).toFixed(1)} ${(CENTRE + reach * Math.sin(rad(deg))).toFixed(1)}`;
  const wedges: string[] = [];
  for (let deg = 0; deg < 360; deg += step) {
    wedges.push(`<path d="M${CENTRE} ${CENTRE}L${corner(deg - 0.6 * step)}L${corner(deg + 0.6 * step)}Z" fill="${champagne(sweepGrey(deg + 0.5 * step))}"/>`);
  }
  return wedges.join('');
}

const roundedSquare = (half: number, radius: number, attrs: string) =>
  `<rect x="${place(-half)}" y="${place(-half)}" width="${scale(half * 2)}" height="${scale(half * 2)}" rx="${scale(radius)}" ${attrs}/>`;

/** The logo as an SVG document. */
export function nextMarkSvg({ tileRadius = DRAWING_TILE_RADIUS, sweepStep = 1, frame = 'mark' }: NextMarkOptions = {}): string {
  const left = legEnd('fade-left', 0);
  const right = legEnd('fade-right', 180);
  const tileTop = place(-TILE_HALF);
  const size = frame === 'icon' ? 1024 : scale(TILE_HALF * 2);
  const origin = frame === 'icon' ? 0 : tileTop;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${origin} ${origin} ${size} ${size}">`,
    '<defs>',
    `<clipPath id="tile">${roundedSquare(TILE_HALF, tileRadius, '')}</clipPath>`,
    `<clipPath id="plate">${roundedSquare(PLATE.half, PLATE.radius, '')}</clipPath>`,
    // Light from above catches the tile's top edge.
    `<linearGradient id="rim" x1="0" y1="${tileTop}" x2="0" y2="${tileTop + 120}" gradientUnits="userSpaceOnUse">` +
      '<stop offset="0" stop-color="#fff" stop-opacity="0.26"/><stop offset="0.25" stop-color="#fff" stop-opacity="0.1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
    // The ribbon is lit from above too: white at its top, a little shaded where it turns at the bottom.
    `<linearGradient id="ribbon" x1="0" y1="${place(-92)}" x2="0" y2="${place(93)}" gradientUnits="userSpaceOnUse">` +
      '<stop offset="0" stop-color="#f8f8f8"/><stop offset="0.5" stop-color="#f4f4f4"/><stop offset="0.68" stop-color="#f2f2f2"/><stop offset="1" stop-color="#e4e4e4"/></linearGradient>',
    left.gradient,
    right.gradient,
    '</defs>',
    roundedSquare(TILE_HALF, tileRadius, `fill="${TILE_GREY}"`),
    `<g clip-path="url(#tile)">${roundedSquare(TILE_HALF, tileRadius, 'fill="none" stroke="url(#rim)" stroke-width="12"')}</g>`,
    '<g clip-path="url(#plate)">',
    sweepWedges(sweepStep),
    `<ellipse cx="${CENTRE}" cy="${CENTRE}" rx="${scale(LENS.a)}" ry="${scale(LENS.b)}" transform="rotate(${LENS.angle} ${CENTRE} ${CENTRE})" fill="${TILE_GREY}"/>`,
    `<path d="${ribbonPath()}" fill="none" stroke="url(#ribbon)" stroke-width="${scale(RIBBON.width)}"/>`,
    left.path,
    right.path,
    '</g>',
    // The plate sits a hair into the tile.
    roundedSquare(PLATE.half, PLATE.radius, 'fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="5"'),
    '</svg>',
    '',
  ].join('\n');
}
