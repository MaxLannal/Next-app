import type { SubjectSlice } from '@shared/types.ts';
import { formatDuration, formatShare } from '../../lib/format.ts';
import { groupSlices } from './colors.ts';
import './charts.css';

type PieProps = {
  slices: SubjectSlice[];
  /** Outer diameter in px. */
  size?: number;
  /** Names the chart for screen readers. */
  label: string;
  /** The figure in the hole, e.g. `"3 h 20 m"`. */
  centerTop?: string;
  /** A muted line under it, e.g. `"this week"`. */
  centerBottom?: string;
};

const TAU = Math.PI * 2;
/** Space between slices, measured straight across (constant from rim to hole). */
const GAP = 2;
/** Ring thickness as a share of the diameter. */
const RING = 0.12;

const n = (v: number) => String(Number(v.toFixed(2)));

/**
 * Subjects as a ring (pies by request), styled the Dusk way: a
 * periwinkle lightness ramp with 2 px gaps, the tail merged into a muted
 * "Other", and an empty ring when there is nothing yet.
 */
export function Pie({ slices, size = 180, label, centerTop, centerBottom }: PieProps) {
  const groups = groupSlices(slices);
  const c = size / 2;
  const outer = c - 1;
  const thickness = Math.max(6, size * RING);
  const inner = outer - thickness;
  const starts = groups.map((_, i) => groups.slice(0, i).reduce((sum, g) => sum + g.share, 0) * TAU);

  return (
    <svg className="pie" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {groups.length === 0 ? (
        <circle className="pie__empty" cx={c} cy={c} r={outer - thickness / 2} strokeWidth={thickness} />
      ) : (
        groups.map((g, i) => (
          <path
            key={g.key}
            data-slice={g.key}
            className="pie__slice"
            d={groups.length === 1 ? ring(c, outer, inner) : sector(c, outer, inner, starts[i] ?? 0, (starts[i] ?? 0) + g.share * TAU)}
            fillRule="evenodd"
            style={{ fill: g.color }}
          >
            <title>{`${g.name} · ${formatDuration(g.seconds)} · ${formatShare(g.share)}`}</title>
          </path>
        ))
      )}
      {centerTop !== undefined && (
        <text className="pie__top" x={c} y={centerBottom === undefined ? c : c - 8} textAnchor="middle" dominantBaseline="central">
          {centerTop}
        </text>
      )}
      {centerBottom !== undefined && (
        <text className="pie__bottom" x={c} y={centerTop === undefined ? c : c + 14} textAnchor="middle" dominantBaseline="central">
          {centerBottom}
        </text>
      )}
    </svg>
  );
}

/** The ruled list beside a pie: swatch, subject, time, share. */
export function PieLegend({ slices }: { slices: SubjectSlice[] }) {
  const groups = groupSlices(slices);
  if (groups.length === 0) return null;
  return (
    <ul className="legend">
      {groups.map((g) => (
        <li key={g.key} className="legend__row">
          <span className="legend__swatch" style={{ background: g.color }} aria-hidden="true" />
          <span className="legend__name">{g.name}</span>
          <span className="legend__value num">{formatDuration(g.seconds)}</span>
          <span className="legend__share num">{formatShare(g.share)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Angles run clockwise from 12 o'clock. */
function point(c: number, r: number, angle: number) {
  return `${n(c + r * Math.sin(angle))} ${n(c - r * Math.cos(angle))}`;
}

/** A whole ring: two half-circles out, two back in (even-odd leaves the hole). */
function ring(c: number, outer: number, inner: number) {
  const half = (r: number, sweep: 0 | 1) =>
    `M${point(c, r, 0)}A${n(r)} ${n(r)} 0 1 ${sweep} ${point(c, r, Math.PI)}A${n(r)} ${n(r)} 0 1 ${sweep} ${point(c, r, 0)}Z`;
  return half(outer, 1) + half(inner, 0);
}

/**
 * One slice of the ring from `a0` to `a1`, its edges pulled in by GAP/2 on each
 * side as parallel lines, so the gap is the same width at the rim and the hole.
 * A sliver narrower than the gap shrinks to a point rather than inverting.
 */
function sector(c: number, outer: number, inner: number, a0: number, a1: number) {
  const span = (r: number) => {
    const off = Math.asin(Math.min(1, GAP / 2 / r));
    const from = a0 + off;
    const to = a1 - off;
    return to > from ? [from, to] : [(a0 + a1) / 2, (a0 + a1) / 2];
  };
  const [o0 = 0, o1 = 0] = span(outer);
  const [i0 = 0, i1 = 0] = span(inner);
  const large = (from: number, to: number) => (to - from > Math.PI ? 1 : 0);
  return (
    `M${point(c, outer, o0)}A${n(outer)} ${n(outer)} 0 ${large(o0, o1)} 1 ${point(c, outer, o1)}` +
    `L${point(c, inner, i1)}A${n(inner)} ${n(inner)} 0 ${large(i0, i1)} 0 ${point(c, inner, i0)}Z`
  );
}
