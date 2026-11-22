import { useEffect, useId, useState, type RefObject } from 'react';
import { useWidth } from './useWidth.ts';
import './charts.css';

type BarsProps = {
  data: { label: string; value: number }[];
  /** Overall height in px, the label row under the bars included. */
  height?: number;
  /** Formats a value for the bar titles and the gridline labels. */
  format: (v: number) => string;
  /** Names the chart for screen readers. */
  label: string;
};

const MAX_BAR = 24;
/** Bars round only at the data end, by at most this much. */
const RADIUS = 2;
/** Room above the top gridline for its label. */
const PAD_TOP = 6;
/** The row of category labels under the baseline. */
const AXIS = 20;
/** Rough advance of one character of 11 px tabular text, for sizing label room. */
const CHAR = 6.2;

const n = (v: number) => Number(v.toFixed(2));

/**
 * Vertical bars in the accent (Hallmark data-viz): ≤ 24 px thick with 2–4 px
 * gaps, a zero baseline, three hairline gridlines (baseline, half, top = the
 * largest value), a `<title>` per bar. They grow from the baseline the first
 * time they scroll into view.
 */
export function Bars({ data, height = 120, format, label }: BarsProps) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const shown = useGrowIn(ref);
  const clipId = `bars-clip-${useId().replace(/[^\w-]/g, '')}`;

  const values = data.map((d) => (Number.isFinite(d.value) && d.value > 0 ? d.value : 0));
  const max = Math.max(0, ...values);
  const count = data.length;
  const base = height - AXIS;
  const plot = base - PAD_TOP;
  const scale = max > 0 ? plot / max : 0;

  // Gridlines at the top, the middle and the baseline; the top two are labelled once there is data.
  const grid = [
    { y: PAD_TOP, text: max > 0 ? format(max) : null },
    { y: PAD_TOP + plot / 2, text: max > 0 ? format(max / 2) : null },
    { y: base, text: null },
  ];
  const longestTick = Math.max(0, ...grid.map((g) => g.text?.length ?? 0));
  const gutter = longestTick > 0 ? Math.ceil(longestTick * CHAR) + 8 : 0;

  const room = Math.max(0, width - gutter);
  const gap = count > 0 ? Math.round(Math.min(4, Math.max(2, room / count / 5))) : 0;
  const bar = count > 0 ? Math.max(1, Math.min(MAX_BAR, Math.floor((room - (count - 1) * gap) / count))) : 0;
  const step = bar + gap;
  const right = count > 0 ? gutter + count * bar + (count - 1) * gap : width;
  const radius = Math.min(RADIUS, bar / 2);
  // Thin the category labels so they never collide.
  const longestLabel = Math.max(0, ...data.map((d) => d.label.length));
  const every = step > 0 ? Math.max(1, Math.ceil((longestLabel * CHAR + 6) / step)) : 1;

  return (
    <div ref={ref} className={shown ? 'bars' : 'bars is-waiting'}>
      <svg role="img" aria-label={label} width={right} height={height}>
        <defs>
          <clipPath id={clipId}>
            <path d={`M0 0H${right}V${base}H0Z`} />
          </clipPath>
        </defs>
        {grid.map((g, i) => (
          <line key={i} className="bars__grid" x1={gutter} x2={right} y1={n(g.y)} y2={n(g.y)} />
        ))}
        {grid.map(
          (g, i) =>
            g.text !== null && (
              <text key={i} className="chart-axis" x={gutter - 8} y={n(g.y)} textAnchor="end" dominantBaseline="central">
                {g.text}
              </text>
            ),
        )}
        {/* Each rect runs `radius` px under the baseline, where the clip hides it,
            so only its data end shows rounded. */}
        <g clipPath={`url(#${clipId})`}>
          {data.map((d, i) => {
            const h = (values[i] ?? 0) * scale;
            return (
              <rect
                key={i}
                className="bars__bar"
                x={gutter + i * step}
                y={n(base - h)}
                width={bar}
                height={h > 0 ? n(h + radius) : 0}
                rx={radius}
                style={{ transitionDelay: `${i * 22}ms` }}
              >
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
            );
          })}
        </g>
        {data.map(
          (d, i) =>
            i % every === 0 && (
              <text key={i} className="chart-axis" x={n(gutter + i * step + bar / 2)} y={height - 4} textAnchor="middle">
                {d.label}
              </text>
            ),
        )}
      </svg>
    </div>
  );
}

/**
 * False until the chart first scrolls into view, then true for good. Where
 * there is no IntersectionObserver (jsdom) or motion is reduced, it starts true.
 */
function useGrowIn(ref: RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState(
    () =>
      typeof IntersectionObserver === 'undefined' ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  );

  useEffect(() => {
    const el = ref.current;
    if (shown || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, shown]);

  return shown;
}
