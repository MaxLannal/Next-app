import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { FocusSession, SkillNode } from '@shared/types.ts';
import { ApiError } from '../../api.ts';
import { formatDayKey, formatDuration, formatShortDate, localDay } from '../../lib/format.ts';
import { AddMenu } from './AddMenu.tsx';
import { FileIcon } from './FileIcon.tsx';
import {
  boxOf,
  contains,
  EXPERIENCE_H,
  EXPERIENCE_W,
  fitView,
  freeSpot,
  layerAt,
  linkPath,
  offsetIn,
  sizeOf,
  slotFor,
  stageLayout,
  stageName,
  STAGE_LEFT,
  STAGE_MIN_H,
  STAGE_PAD_TOP,
  STAGE_W,
  STEP_H,
  STEP_MAX_W,
  STEP_MIN_W,
  STEP_W,
  toWorld,
  zoomAt,
  type Box,
  type Layout,
  type Size,
  type View,
} from './geometry.ts';
import { SessionPicker } from './SessionPicker.tsx';
import { useBoard, useBoardActions } from './useBoard.ts';

/** A card being dragged: where it is in the world, and the stage layout frozen when it was picked up. */
type Drag = { id: number; pointerId: number; dx: number; dy: number; moved: boolean; wx: number; wy: number; layout: Layout };
type Pan = { pointerId: number; x: number; y: number; tx: number; ty: number };

/** Files shown on an experience before the rest fold into "+n". */
const FILES_SHOWN = 6;

const messageOf = (err: unknown) => (err instanceof ApiError && err.status !== 0 ? err.message : 'The hub didn’t answer — retry');

/**
 * One skill's canvas: a dotted black field you pan (drag the background, or scroll) and zoom
 * (⌘/ctrl-scroll, pinch, or the buttons). It is split into stages stacked upward — the
 * foundations at the bottom, harder work above — with one empty stage always waiting on top.
 * Each stage is as tall as what it holds. Steps say what was learned; experiences are focus
 * sessions, with their files. Drop an experience on a step to link them; drag anything up a
 * stage when the work has grown harder.
 */
export function SkillCanvas({ skillId }: { skillId: number }) {
  const board = useBoard(skillId);
  const actions = useBoardActions(skillId);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [nodes, setNodes] = useState<SkillNode[]>([]);
  const [sizes, setSizes] = useState<ReadonlyMap<number, Size>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef(false);
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const [freshLinks, setFreshLinks] = useState<Set<number>>(new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pan = useRef<Pan | null>(null);
  dragging.current = drag !== null;

  // The canvas keeps its own copy of the nodes, so a drag moves smoothly before it is saved.
  useEffect(() => {
    if (board.data && !dragging.current) setNodes(board.data.nodes);
  }, [board.data]);

  // Cards size themselves to their text and files; each one's measured size feeds the stage heights.
  const observer = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) =>
            setSizes((prev) => {
              let next: Map<number, Size> | null = null;
              for (const e of entries) {
                const el = e.target as HTMLElement;
                const id = Number(el.dataset.node);
                const size = { w: el.offsetWidth, h: el.offsetHeight };
                const old = prev.get(id);
                if (size.w === 0 || (old && old.w === size.w && old.h === size.h)) continue;
                next ??= new Map(prev);
                next.set(id, size);
              }
              return next ?? prev;
            }),
          ),
    [],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);
  const track = useCallback((el: HTMLDivElement | null) => void (el && observer?.observe(el)), [observer]);

  const links = board.data?.links ?? [];
  const stageNames = board.data?.skill.stageNames ?? {};
  const liveLayout = useMemo(() => stageLayout(nodes, sizes), [nodes, sizes]);
  // While a card is carried, the stages hold still under it.
  const layout = drag?.layout ?? liveLayout;
  const stages = layout.tops.length;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const box = (n: SkillNode): Box => {
    if (drag && drag.id === n.id) return { x: drag.wx, y: drag.wy, ...sizeOf(n, sizes) };
    return boxOf(n, sizes, layout);
  };
  const linkedCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const l of links) counts.set(l.stepId, (counts.get(l.stepId) ?? 0) + 1);
    return counts;
  }, [links]);
  const sessionsOnCanvas = useMemo(() => new Set(nodes.flatMap((n) => (n.session ? [n.session.id] : []))), [nodes]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (el) setView(fitView(liveLayout, el.clientWidth, el.clientHeight));
  }, [liveLayout]);

  // First fit once the board is there and the viewport has a size (it can be laid out at 0 × 0 first).
  const [hasSize, setHasSize] = useState(false);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || hasSize) return;
    if (el.clientWidth > 0 && el.clientHeight > 0) return setHasSize(true);
    if (typeof ResizeObserver === 'undefined') return setHasSize(true);
    const watch = new ResizeObserver(() => el.clientWidth > 0 && el.clientHeight > 0 && setHasSize(true));
    watch.observe(el);
    return () => watch.disconnect();
  }, [board.data, hasSize]);
  useLayoutEffect(() => {
    if (view === null && hasSize && board.data && viewport.current) {
      const el = viewport.current;
      setView(fitView(stageLayout(board.data.nodes, new Map()), el.clientWidth, el.clientHeight));
    }
  }, [board.data, view, hasSize]);

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
    if (e.button !== 0 || !view || (e.target as HTMLElement).closest('.node, .addmenu, .picker, .canvas__tools, .stage__label')) return;
    pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // ── Dragging a node ──
  const onNodeDown = (e: ReactPointerEvent<HTMLDivElement>, node: SkillNode) => {
    if (e.button !== 0 || !view || (e.target as HTMLElement).closest('input, textarea, button, a, label')) return;
    e.stopPropagation();
    const at = local(e);
    const p = toWorld(view, at.x, at.y);
    const b = boxOf(node, sizes, liveLayout);
    setDrag({ id: node.id, pointerId: e.pointerId, dx: p.x - b.x, dy: p.y - b.y, moved: false, wx: b.x, wy: b.y, layout: liveLayout });
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
    const wx = p.x - drag.dx;
    const wy = p.y - drag.dy;
    setDrag({ ...drag, wx, wy, moved: true });
    const node = byId.get(drag.id);
    if (node?.kind === 'experience') {
      const { w, h } = sizeOf(node, sizes);
      const over = nodes.find((n) => n.kind === 'step' && contains(boxOf(n, sizes, drag.layout), wx + w / 2, wy + h / 2));
      setHoverStep(over ? over.id : null);
    }
  };

  /** Glides a node within `layer` from one stage-relative spot to another, with a little overshoot, then saves where it settled. */
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
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / 420);
      const e = back(t);
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, x, y, layer } : n)));
      if (t < 1) requestAnimationFrame(frame);
      else save();
    };
    requestAnimationFrame(frame);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current && pan.current.pointerId === e.pointerId) {
      pan.current = null;
      return;
    }
    if (!drag || drag.pointerId !== e.pointerId) return;
    const node = byId.get(drag.id);
    const target = hoverStep;
    const frozen = drag.layout;
    setDrag(null);
    setHoverStep(null);
    if (!node || !drag.moved) return;
    const { w, h } = sizeOf(node, sizes);
    const step = target !== null ? byId.get(target) : undefined;
    if (node.kind === 'experience' && step) {
      // Linked: the experience glides into its slot under the step, and the thread draws.
      const siblings = links.filter((l) => l.stepId === step.id && l.experienceId !== node.id).map((l) => byId.get(l.experienceId));
      const rowH = Math.max(EXPERIENCE_H, ...siblings.map((s) => (s ? sizeOf(s, sizes).h : 0)), h);
      const slot = slotFor(boxOf(step, sizes, frozen), siblings.length, rowH);
      const top = frozen.tops[step.layer];
      const from = { x: drag.wx, y: drag.wy - top };
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, ...from, layer: step.layer } : n)));
      glide(node.id, from, { x: slot.x, y: offsetIn(slot.y, step.layer, frozen) }, step.layer);
      void actions
        .link(step.id, node.id)
        .then((link) => {
          setFreshLinks((f) => new Set(f).add(link.id));
          setNote(null);
        })
        .catch(fail);
      return;
    }
    const layer = layerAt(drag.wy + h / 2, frozen);
    const y = offsetIn(drag.wy, layer, frozen);
    const x = Math.min(STAGE_LEFT + STAGE_W - w - 16, Math.max(STAGE_LEFT + 16, drag.wx));
    setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, x, y, layer } : n)));
    void actions.editNode(node.id, { x, y, layer }).catch(fail);
  };

  // ── Adding ──
  const viewCenter = () => {
    const el = viewport.current;
    if (!view || !el) return { x: 0, y: -STAGE_MIN_H / 2 };
    return toWorld(view, el.clientWidth / 2, el.clientHeight / 2);
  };
  const boxes = () => nodes.map((n) => boxOf(n, sizes, liveLayout));

  const addStep = async () => {
    const c = viewCenter();
    const layer = layerAt(c.y, liveLayout);
    const top = liveLayout.tops[layer];
    try {
      const want = { x: c.x - STEP_W / 2, y: Math.max(top + STAGE_PAD_TOP, c.y - STEP_H / 2), w: STEP_W, h: STEP_H };
      const spot = freeSpot(boxes(), want);
      const node = await actions.addNode({ kind: 'step', layer, x: spot.x, y: offsetIn(spot.y, layer, liveLayout), completedOn: localDay(new Date().toISOString()) });
      setNodes((ns) => [...ns, node]);
      setFocusId(node.id);
    } catch (err) {
      fail(err);
    }
  };

  const addExperiences = async (sessions: FocusSession[]) => {
    setPicking(false);
    const c = viewCenter();
    const layer = layerAt(c.y, liveLayout);
    const top = liveLayout.tops[layer];
    const startX = c.x - ((EXPERIENCE_W + 16) * sessions.length - 16) / 2;
    const y = Math.max(top + STAGE_PAD_TOP, c.y + STEP_H / 2 + 24);
    try {
      const created: SkillNode[] = [];
      const taken = boxes();
      for (const [i, s] of sessions.entries()) {
        const spot = freeSpot(taken, { x: startX + i * (EXPERIENCE_W + 16), y, w: EXPERIENCE_W, h: EXPERIENCE_H });
        taken.push({ ...spot, w: EXPERIENCE_W, h: EXPERIENCE_H });
        created.push(await actions.addNode({ kind: 'experience', sessionId: s.id, layer, x: spot.x, y: offsetIn(spot.y, layer, liveLayout) }));
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
  const draggingLayer = dragged && drag ? layerAt(drag.wy + sizeOf(dragged, sizes).h / 2, drag.layout) : null;

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
          {/* Only the lines between stages are drawn: the foundations have no floor, the open stage no ceiling. */}
          {layout.tops.map((top, i) => (
            <div
              key={i}
              className={['stage', i === stages - 1 ? 'is-open' : '', draggingLayer === i ? 'is-target' : ''].join(' ')}
              style={{ left: STAGE_LEFT, top, width: STAGE_W, height: layout.heights[i] }}
            />
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
                  d={linkPath(box(exp), box(step))}
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

          {nodes.map((n) => {
            const b = box(n);
            return n.kind === 'step' ? (
              <StepNode
                key={n.id}
                node={n}
                at={b}
                nodeRef={track}
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
                at={b}
                nodeRef={track}
                linked={links.some((l) => l.experienceId === n.id)}
                dragging={drag?.id === n.id && drag.moved}
                onPointerDown={(e) => onNodeDown(e, n)}
                onDelete={() => void actions.removeNode(n.id).catch(fail)}
              />
            );
          })}
        </div>
      )}

      {/* The stage names stay at the screen's left edge, wherever the canvas has been panned. */}
      {view &&
        layout.tops.map((top, i) => (
          <StageLabel
            key={i}
            index={i}
            name={stageNames[i] ?? ''}
            open={i === stages - 1}
            top={view.ty + top * view.k + 12}
            onSave={(name) => void actions.nameStage(i, name).catch(fail)}
          />
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

/** "Stage 2" and a field to name it; nothing is named until you type a name. */
function StageLabel({ index, name, open, top, onSave }: { index: number; name: string; open: boolean; top: number; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const placeholder = 'Name this stage';
  return (
    <div className={open ? 'stage__label is-open' : 'stage__label'} style={{ top }}>
      <span className="stage__num">Stage {index + 1}</span>
      <input
        className="stage__name"
        aria-label={`Name of ${stageName(index, {})}`}
        placeholder={placeholder}
        value={value}
        maxLength={60}
        size={Math.max(value.length, placeholder.length) + 1}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== name && onSave(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

type NodeBase = {
  node: SkillNode;
  at: Box;
  nodeRef: (el: HTMLDivElement | null) => void;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDelete: () => void;
};

type StepNodeProps = NodeBase & {
  linked: number;
  autoFocus: boolean;
  dropping: boolean;
  onSave: (edit: { title?: string; description?: string; completedOn?: string | null }) => void;
};

/**
 * A step: a black card with the day it was completed, what was learned and a line on it, typed in
 * place. It widens with its text up to a limit, then wraps and grows taller.
 */
function StepNode({ node, at, nodeRef, linked, autoFocus, dropping, dragging, onPointerDown, onSave, onDelete }: StepNodeProps) {
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState(node.description);
  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setDescription(node.description), [node.description]);
  const titleHint = 'What you learned';
  const descHint = 'A line on the next level it opened';

  return (
    <div
      ref={nodeRef}
      className={['node', 'node--step', dropping ? 'is-drop' : '', dragging ? 'is-dragging' : ''].join(' ')}
      style={{ left: at.x, top: at.y, minWidth: STEP_MIN_W, maxWidth: STEP_MAX_W }}
      onPointerDown={onPointerDown}
      data-node={node.id}
    >
      <span className="node__head">
        <span className="node__kind">Step</span>
        <label className="node__date num" title="The day you completed this step">
          {node.completedOn ? formatDayKey(node.completedOn) : 'Add the day'}
          <input
            type="date"
            aria-label="Completed on"
            value={node.completedOn ?? ''}
            onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            onChange={(e) => onSave({ completedOn: e.target.value || null })}
          />
        </label>
      </span>
      <span className="grow grow--title" data-value={title || titleHint}>
        <textarea
          className="node__title"
          aria-label="Step title"
          placeholder={titleHint}
          value={title}
          rows={1}
          cols={1}
          autoFocus={autoFocus}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onBlur={() => title !== node.title && onSave({ title })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
      </span>
      <span className="grow grow--desc" data-value={description || descHint}>
        <textarea
          className="node__desc"
          aria-label="Step description"
          placeholder={descHint}
          value={description}
          rows={1}
          cols={1}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== node.description && onSave({ description })}
        />
      </span>
      <span className="node__count num">{linked === 0 ? 'No experiences yet' : `${linked} ${linked === 1 ? 'experience' : 'experiences'}`}</span>
      <button className="node__x" type="button" aria-label={`Delete step ${node.title || 'untitled'}`} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

/** An experience: the focus session behind a step, and the files from it. Drag it onto a step to link them. */
function ExperienceNode({ node, at, nodeRef, linked, dragging, onPointerDown, onDelete }: NodeBase & { linked: boolean }) {
  const s = node.session;
  const files = s?.files ?? [];
  const shown = files.length > FILES_SHOWN ? files.slice(0, FILES_SHOWN - 1) : files;
  const more = files.length - shown.length;
  return (
    <div
      ref={nodeRef}
      className={['node', 'node--exp', linked ? 'is-linked' : '', dragging ? 'is-dragging' : ''].join(' ')}
      style={{ left: at.x, top: at.y, width: EXPERIENCE_W }}
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
      {files.length > 0 && (
        <span className="node__files" aria-label={`${files.length} ${files.length === 1 ? 'file' : 'files'} from this session`}>
          {shown.map((f) => (
            <FileIcon key={f.id} file={f} />
          ))}
          {more > 0 && <span className="file file--more num">+{more}</span>}
        </span>
      )}
      <button className="node__x" type="button" aria-label={`Remove experience ${s?.name ?? ''}`.trim()} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}
