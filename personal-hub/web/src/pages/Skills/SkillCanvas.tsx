import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { FocusSession, SkillNode } from '@shared/types.ts';
import { ApiError } from '../../api.ts';
import { formatDuration, formatShortDate } from '../../lib/format.ts';
import { AddMenu } from './AddMenu.tsx';
import {
  boxOf,
  contains,
  EXPERIENCE_H,
  EXPERIENCE_W,
  fitView,
  freeSpot,
  layerAt,
  linkPath,
  slotFor,
  stageCount,
  stageName,
  stageTop,
  STAGE_H,
  STAGE_LEFT,
  STAGE_W,
  STEP_H,
  STEP_W,
  toWorld,
  yInLayer,
  zoomAt,
  type View,
} from './geometry.ts';
import { SessionPicker } from './SessionPicker.tsx';
import { useBoard, useBoardActions } from './useBoard.ts';

type Drag = { id: number; pointerId: number; dx: number; dy: number; moved: boolean };
type Pan = { pointerId: number; x: number; y: number; tx: number; ty: number };

const messageOf = (err: unknown) => (err instanceof ApiError && err.status !== 0 ? err.message : 'The hub didn’t answer — retry');

/**
 * One skill's canvas: a dotted black field you pan (drag the background, or scroll) and zoom
 * (⌘/ctrl-scroll, pinch, or the buttons). It is split into stages stacked upward — the
 * foundations at the bottom, harder work above — with one empty stage always waiting on top.
 * Steps say what was learned; experiences are focus sessions. Drop an experience on a step to
 * link them; drag anything up a stage when the work has grown harder.
 */
export function SkillCanvas({ skillId }: { skillId: number }) {
  const board = useBoard(skillId);
  const actions = useBoardActions(skillId);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [nodes, setNodes] = useState<SkillNode[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const [freshLinks, setFreshLinks] = useState<Set<number>>(new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pan = useRef<Pan | null>(null);

  // The canvas keeps its own copy of the nodes, so a drag moves smoothly before it is saved.
  useEffect(() => {
    if (board.data && drag === null) setNodes(board.data.nodes);
  }, [board.data, drag]);

  const links = board.data?.links ?? [];
  const stages = stageCount(nodes);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const linkedCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const l of links) counts.set(l.stepId, (counts.get(l.stepId) ?? 0) + 1);
    return counts;
  }, [links]);
  const sessionsOnCanvas = useMemo(() => new Set(nodes.flatMap((n) => (n.session ? [n.session.id] : []))), [nodes]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (el) setView(fitView(stageCount(nodes), el.clientWidth, el.clientHeight));
  }, [nodes]);

  // First fit once the board and the viewport are both there.
  useLayoutEffect(() => {
    if (view === null && board.data && viewport.current) {
      const el = viewport.current;
      setView(fitView(stageCount(board.data.nodes), el.clientWidth, el.clientHeight));
    }
  }, [board.data, view]);

  // Scroll pans; ⌘/ctrl-scroll and pinch zoom about the pointer. Not passive, so the page never scrolls.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        if (!v) return v;
        if (e.ctrlKey || e.metaKey) return zoomAt(v, Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
        return { ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [board.data]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = viewport.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const fail = (err: unknown) => setNote(messageOf(err));

  // ── Panning the background ──
  const onBackgroundDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !view || (e.target as HTMLElement).closest('.node, .addmenu, .picker, .canvas__tools')) return;
    pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // ── Dragging a node ──
  const onNodeDown = (e: ReactPointerEvent<HTMLDivElement>, node: SkillNode) => {
    if (e.button !== 0 || !view || (e.target as HTMLElement).closest('input, textarea, button')) return;
    e.stopPropagation();
    const at = local(e);
    const p = toWorld(view, at.x, at.y);
    setDrag({ id: node.id, pointerId: e.pointerId, dx: p.x - node.x, dy: p.y - node.y, moved: false });
    viewport.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current && pan.current.pointerId === e.pointerId) {
      const p = pan.current;
      setView((v) => (v ? { ...v, tx: p.tx + e.clientX - p.x, ty: p.ty + e.clientY - p.y } : v));
      return;
    }
    if (!drag || drag.pointerId !== e.pointerId || !view) return;
    const at = local(e);
    const p = toWorld(view, at.x, at.y);
    const x = p.x - drag.dx;
    const y = p.y - drag.dy;
    setNodes((ns) => ns.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const node = byId.get(drag.id);
    if (node?.kind === 'experience') {
      const cx = x + EXPERIENCE_W / 2;
      const cy = y + EXPERIENCE_H / 2;
      const over = nodes.find((n) => n.kind === 'step' && contains(boxOf(n), cx, cy));
      setHoverStep(over ? over.id : null);
    }
  };

  /** Glides a node to (x, y) with a little overshoot, then saves where it settled. */
  const glide = (id: number, from: { x: number; y: number }, to: { x: number; y: number }, layer: number) => {
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const save = () => void actions.editNode(id, { x: to.x, y: to.y, layer }).catch(fail);
    if (still) {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...to, layer } : n)));
      save();
      return;
    }
    const start = performance.now();
    const back = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 420);
      const e = back(t);
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, x, y, layer } : n)));
      if (t < 1) requestAnimationFrame(step);
      else save();
    };
    requestAnimationFrame(step);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current && pan.current.pointerId === e.pointerId) {
      pan.current = null;
      return;
    }
    if (!drag || drag.pointerId !== e.pointerId) return;
    const node = byId.get(drag.id);
    const target = hoverStep;
    setDrag(null);
    setHoverStep(null);
    if (!node || !drag.moved) return;
    const box = boxOf(node);
    const layer = layerAt(node.y + box.h / 2, stages);
    const y = yInLayer(node.y, box.h, layer);
    const x = Math.min(STAGE_LEFT + STAGE_W - box.w - 16, Math.max(STAGE_LEFT + 16, node.x));
    const step = target !== null ? byId.get(target) : undefined;
    if (node.kind === 'experience' && step) {
      // Linked: the experience glides into its slot under (or beside) the step, and the thread draws.
      const index = links.filter((l) => l.stepId === step.id && l.experienceId !== node.id).length;
      glide(node.id, { x: node.x, y: node.y }, slotFor(boxOf(step), index, step.layer), step.layer);
      void actions
        .link(step.id, node.id)
        .then((link) => {
          setFreshLinks((f) => new Set(f).add(link.id));
          setNote(null);
        })
        .catch(fail);
      return;
    }
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, x, y, layer } : n)));
    void actions.editNode(node.id, { x, y, layer }).catch(fail);
  };

  // ── Adding ──
  const viewCenter = () => {
    const el = viewport.current;
    if (!view || !el) return { x: 0, y: -STAGE_H / 2 };
    return toWorld(view, el.clientWidth / 2, el.clientHeight / 2);
  };

  const addStep = async () => {
    const c = viewCenter();
    const layer = layerAt(c.y, stages);
    try {
      const spot = freeSpot(nodes.map(boxOf), { x: c.x - STEP_W / 2, y: yInLayer(c.y - STEP_H / 2, STEP_H, layer), w: STEP_W, h: STEP_H });
      const node = await actions.addNode({ kind: 'step', layer, ...spot });
      setNodes((ns) => [...ns, node]);
      setFocusId(node.id);
    } catch (err) {
      fail(err);
    }
  };

  const addExperiences = async (sessions: FocusSession[]) => {
    setPicking(false);
    const c = viewCenter();
    const layer = layerAt(c.y, stages);
    const startX = c.x - ((EXPERIENCE_W + 16) * sessions.length - 16) / 2;
    const y = yInLayer(c.y + STEP_H / 2 + 24, EXPERIENCE_H, layer);
    try {
      const created: SkillNode[] = [];
      for (const [i, s] of sessions.entries()) {
        const taken = [...nodes, ...created].map(boxOf);
        const spot = freeSpot(taken, { x: startX + i * (EXPERIENCE_W + 16), y, w: EXPERIENCE_W, h: EXPERIENCE_H });
        created.push(await actions.addNode({ kind: 'experience', sessionId: s.id, layer, ...spot }));
      }
      setNodes((ns) => [...ns, ...created]);
      setNote('Drag an experience onto a step to link them.');
    } catch (err) {
      fail(err);
    }
  };

  const zoomBy = (factor: number) => {
    const el = viewport.current;
    if (el) setView((v) => (v ? zoomAt(v, factor, el.clientWidth / 2, el.clientHeight / 2) : v));
  };

  if (board.isError) return <p className="canvas__state">{messageOf(board.error)}</p>;
  if (!board.data) return <p className="canvas__state" aria-busy="true" />;

  const dragged = drag?.moved ? byId.get(drag.id) : undefined;
  const draggingLayer = dragged ? layerAt(dragged.y + boxOf(dragged).h / 2, stages) : null;

  return (
    <div
      ref={viewport}
      className={drag?.moved ? 'canvas is-dragging' : 'canvas'}
      style={view ? ({ '--dot-size': `${24 * view.k}px`, backgroundPosition: `${view.tx}px ${view.ty}px` } as CSSProperties) : undefined}
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {view && (
        <div className="canvas__world" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}>
          {Array.from({ length: stages }, (_, i) => (
            <div
              key={i}
              className={['stage', i === stages - 1 ? 'is-open' : '', draggingLayer === i ? 'is-target' : ''].join(' ')}
              style={{ left: STAGE_LEFT, top: stageTop(i), width: STAGE_W, height: STAGE_H }}
            >
            </div>
          ))}

          <svg className="canvas__links" width="1" height="1" aria-hidden="true">
            {links.map((l) => {
              const step = byId.get(l.stepId);
              const exp = byId.get(l.experienceId);
              if (!step || !exp) return null;
              return (
                <path
                  key={l.id}
                  className={freshLinks.has(l.id) ? 'link is-fresh' : 'link'}
                  d={linkPath(boxOf(exp), boxOf(step))}
                  pathLength={1}
                  onAnimationEnd={() =>
                    setFreshLinks((f) => {
                      const next = new Set(f);
                      next.delete(l.id);
                      return next;
                    })
                  }
                />
              );
            })}
          </svg>

          {nodes.map((n) =>
            n.kind === 'step' ? (
              <StepNode
                key={n.id}
                node={n}
                linked={linkedCount.get(n.id) ?? 0}
                autoFocus={focusId === n.id}
                dropping={hoverStep === n.id}
                dragging={drag?.id === n.id && drag.moved}
                onPointerDown={(e) => onNodeDown(e, n)}
                onSave={(edit) => void actions.editNode(n.id, edit).catch(fail)}
                onDelete={() => void actions.removeNode(n.id).catch(fail)}
              />
            ) : (
              <ExperienceNode
                key={n.id}
                node={n}
                linked={links.some((l) => l.experienceId === n.id)}
                dragging={drag?.id === n.id && drag.moved}
                onPointerDown={(e) => onNodeDown(e, n)}
                onDelete={() => void actions.removeNode(n.id).catch(fail)}
              />
            ),
          )}
        </div>
      )}

      {/* The stage names stay at the screen's left edge, wherever the canvas has been panned. */}
      {view &&
        Array.from({ length: stages }, (_, i) => (
          <span key={i} className={i === stages - 1 ? 'stage__label is-open' : 'stage__label'} style={{ top: view.ty + stageTop(i) * view.k + 12 }}>
            {stageName(i, stages)}
          </span>
        ))}

      {nodes.length === 0 && (
        <p className="canvas__hint">
          Press <b>+</b> to add your first step — what you learned, in a line — then link the focus sessions that got you there.
        </p>
      )}

      <div className="canvas__tools" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <span className="num">{view ? Math.round(view.k * 100) : 100}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button type="button" className="canvas__fit" onClick={fit}>
          Fit
        </button>
      </div>

      {note !== null && (
        <p className="canvas__note" role="status" onAnimationEnd={() => setNote(null)}>
          {note}
        </p>
      )}

      <AddMenu onStep={() => void addStep()} onExperience={() => setPicking(true)} />
      {picking && <SessionPicker onCanvas={sessionsOnCanvas} onAdd={(s) => void addExperiences(s)} onClose={() => setPicking(false)} />}
    </div>
  );
}

type StepNodeProps = {
  node: SkillNode;
  linked: number;
  autoFocus: boolean;
  dropping: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onSave: (edit: { title?: string; description?: string }) => void;
  onDelete: () => void;
};

/** A step: a black card with what was learned and a line on it, typed in place. */
function StepNode({ node, linked, autoFocus, dropping, dragging, onPointerDown, onSave, onDelete }: StepNodeProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description);
  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setDescription(node.description), [node.description]);

  return (
    <div
      className={['node', 'node--step', dropping ? 'is-drop' : '', dragging ? 'is-dragging' : ''].join(' ')}
      style={{ left: node.x, top: node.y, width: STEP_W, height: STEP_H }}
      onPointerDown={onPointerDown}
      data-node={node.id}
    >
      <span className="node__kind">Step</span>
      <input
        className="node__title"
        aria-label="Step title"
        placeholder="What you learned"
        value={title}
        autoFocus={autoFocus}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== node.title && onSave({ title })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <textarea
        className="node__desc"
        aria-label="Step description"
        placeholder="A line on the next level it opened"
        value={description}
        maxLength={2000}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== node.description && onSave({ description })}
      />
      <span className="node__count num">{linked === 0 ? 'No experiences yet' : `${linked} ${linked === 1 ? 'experience' : 'experiences'}`}</span>
      <button className="node__x" type="button" aria-label={`Delete step ${node.title || 'untitled'}`} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

type ExperienceNodeProps = {
  node: SkillNode;
  linked: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDelete: () => void;
};

/** An experience: the focus session behind a step. Drag it onto a step to link them. */
function ExperienceNode({ node, linked, dragging, onPointerDown, onDelete }: ExperienceNodeProps) {
  const s = node.session;
  return (
    <div
      className={['node', 'node--exp', linked ? 'is-linked' : '', dragging ? 'is-dragging' : ''].join(' ')}
      style={{ left: node.x, top: node.y, width: EXPERIENCE_W, height: EXPERIENCE_H }}
      onPointerDown={onPointerDown}
      data-node={node.id}
    >
      <span className="node__kind">Experience</span>
      <span className="node__name">{s ? s.name : 'A deleted session'}</span>
      {s && (
        <span className="node__meta num">
          {s.subject ? `${s.subject} · ` : ''}
          {formatShortDate(s.startedAt)} · {formatDuration(s.focusSeconds)}
        </span>
      )}
      <button className="node__x" type="button" aria-label={`Remove experience ${s?.name ?? ''}`.trim()} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}
