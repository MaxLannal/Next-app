import './SkillPyramid.css';

type SkillPyramidProps = {
  /** Steps in each stage, foundations first. */
  layerSteps: number[];
  /** All the stages, including the empty one on top. */
  stages: number;
  size?: number;
  label: string;
};

const W = 200;
const H = 170;
const GAP = 4;

/**
 * The climb as a pyramid: one band per stage, the foundations widest at the bottom. Stages with
 * work are filled (a dot per step, up to what fits), the stage being worked in glows, and the
 * empty stage on top is a dashed outline waiting to be reached.
 */
export function SkillPyramid({ layerSteps, stages, size = 200, label }: SkillPyramidProps) {
  const count = Math.max(1, stages);
  const band = (H - GAP * (count - 1)) / count;
  const current = layerSteps.reduce((top, n, i) => (n > 0 ? i : top), -1);
  const halfAt = (y: number) => (y / H) * (W / 2);

  return (
    <svg className="pyramid" viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} role="img" aria-label={label}>
      {Array.from({ length: count }, (_, i) => {
        // Band i counts up from the bottom.
        const bottom = H - i * (band + GAP);
        const top = bottom - band;
        const hb = halfAt(bottom);
        const ht = halfAt(top);
        const points = `${W / 2 - ht},${top} ${W / 2 + ht},${top} ${W / 2 + hb},${bottom} ${W / 2 - hb},${bottom}`;
        const steps = layerSteps[i] ?? 0;
        const state = i === count - 1 && steps === 0 ? 'open' : i === current ? 'current' : steps > 0 ? 'done' : 'empty';
        // Dots along the band's middle, as many as fit (and as there are steps).
        const mid = (top + bottom) / 2;
        const room = Math.floor((halfAt(mid) * 2 - 16) / 12);
        const dots = Math.max(0, Math.min(steps, room));
        const start = W / 2 - ((dots - 1) * 12) / 2;
        return (
          <g key={i} className={`pyramid__band is-${state}`} data-stage={i + 1}>
            <polygon points={points} />
            {Array.from({ length: dots }, (_, d) => (
              <circle key={d} className="pyramid__dot" cx={start + d * 12} cy={mid} r={2.6} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
