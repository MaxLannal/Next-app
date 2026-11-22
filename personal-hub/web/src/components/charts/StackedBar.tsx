import { formatShare } from '../../lib/format.ts';
import { useWidth } from './useWidth.ts';
import './charts.css';

type Part = { label: string; value: number; color: string };

type StackedBarProps = {
  parts: Part[];
  /** Names the chart for screen readers. */
  label: string;
};

const THICKNESS = 12;
const GAP = 2;

const n = (v: number) => Number(v.toFixed(2));

/**
 * Parts of a whole as one horizontal bar (Hallmark data-viz's form for this),
 * square-cornered parts end to end with 2 px gaps, and a legend below:
 * swatch, label, share.
 * Parts with nothing in them stay in the legend but draw no segment.
 */
export function StackedBar({ parts, label }: StackedBarProps) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const clean = parts.map((p) => ({ ...p, value: Number.isFinite(p.value) && p.value > 0 ? p.value : 0 }));
  const total = clean.reduce((sum, p) => sum + p.value, 0);
  const drawn = clean.filter((p) => p.value > 0);
  const room = Math.max(0, width - GAP * (drawn.length - 1));
  const segments = drawn.map((p, i) => {
    const before = drawn.slice(0, i).reduce((sum, q) => sum + q.value, 0);
    return { ...p, x: (room * before) / total + GAP * i, w: (room * p.value) / total };
  });

  return (
    <div ref={ref} className="stack">
      <svg role="img" aria-label={label} width={width} height={THICKNESS}>
        {segments.length === 0 ? (
          <rect className="stack__track" x={0} y={0} width={width} height={THICKNESS} />
        ) : (
          segments.map((s) => (
            <rect
              key={s.label}
              data-part={s.label}
              x={n(s.x)}
              y={0}
              width={n(s.w)}
              height={THICKNESS}
              style={{ fill: s.color }}
            >
              <title>{`${s.label} · ${formatShare(s.value / total)}`}</title>
            </rect>
          ))
        )}
      </svg>
      <ul className="stack__legend">
        {clean.map((p) => (
          <li key={p.label}>
            <span className="legend__swatch" style={{ background: p.color }} aria-hidden="true" />
            {p.label}
            <span className="num c">{formatShare(total > 0 ? p.value / total : 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
