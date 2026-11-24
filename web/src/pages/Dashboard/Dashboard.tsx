import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  addPage,
  deletePage,
  hiddenPanels,
  hidePanel,
  MAX_PAGES,
  movePanel,
  renamePage,
  resizePanel,
  type PanelId,
  type PanelPlace,
} from '@shared/layout.ts';
import { useCurrentSession } from './focus/useSessions.ts';
import { ResourcesPanel } from './resources/ResourcesPanel.tsx';
import { CalendarPanel } from './calendar/CalendarPanel.tsx';
import { TodayAgenda } from './calendar/TodayAgenda.tsx';
import { TimePanel } from './time/TimePanel.tsx';
import { ExercisePanel } from './exercise/ExercisePanel.tsx';
import { NowPlayingPanel } from './media/NowPlayingPanel.tsx';
import { YearOfFocusPanel } from './heatmap/YearOfFocusPanel.tsx';
import { SleepPanel } from './sleep/SleepPanel.tsx';
import { FocusPanel } from './focus/FocusPanel.tsx';
import { GoalsPanel } from './goals/GoalsPanel.tsx';
import { SkillTrackerPanel } from './skills/SkillTrackerPanel.tsx';
import { DEFAULT_WALLPAPER, useWallpaper } from '../../lib/useWallpaper.ts';
import { DRAG_TYPE, EditBar, PageHead, SlotTools } from './EditLayout.tsx';
import { useLayout } from './useLayout.ts';
import { usePager } from './usePager.ts';
import './pages.css';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

const PANELS: Record<PanelId, () => ReactNode> = {
  goals: () => <GoalsPanel />,
  focus: () => <FocusPanel />,
  skills: () => <SkillTrackerPanel />,
  heatmap: () => <YearOfFocusPanel />,
  sleep: () => <SleepPanel />,
  exercise: () => <ExercisePanel />,
  calendar: () => <CalendarPanel />,
  resources: () => <ResourcesPanel />,
  media: () => <NowPlayingPanel />,
};

/** Hovering a dragged panel over a page's dot this long turns to that page. */
const DOT_HOVER_MS = 450;

type Drop = { page: number; index: number };

/**
 * The dashboard's pages over the wallpaper, each a whole screen, turned with some force
 * (usePager). The first is headed by the time and today's agenda; which panels each page holds,
 * in what order and at what size, is the layout (useLayout), arranged by hand in edit mode: drag a
 * panel to move it (onto a page's dot for another page), size it, hide it, add and delete pages.
 * A small window scrolls through the pages as one.
 */
export function Dashboard() {
  reserveForTimer();
  // The wallpaper chosen in Settings, else the fog photograph (which alone needs its credit).
  const wallpaper = useWallpaper();
  const { layout, change, reset, failed } = useLayout();
  const pager = usePager(layout.pages.length);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const dotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = layout.pages.length - 1;
  const pageNames = layout.pages.map((p) => p.name);

  // Esc leaves edit mode (unless a sheet is open: Esc is the sheet's).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]') && !(e.target instanceof HTMLInputElement)) setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const place = (id: PanelId, page: number, index: number) => change(movePanel(layout, id, page, index));
  const endDrag = () => {
    setDragging(null);
    setDrop(null);
    if (dotTimer.current) clearTimeout(dotTimer.current);
  };
  const aim = (to: Drop) => {
    if (drop?.page !== to.page || drop.index !== to.index) setDrop(to);
  };
  const dropped = (e: DragEvent, fallback: Drop) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragging ?? (e.dataTransfer.getData(DRAG_TYPE) as PanelId);
    const to = drop ?? fallback;
    if (id) place(id, to.page, to.index);
    endDrag();
  };

  /** A panel being dropped on: it lands before this one, or after it from its right half. */
  const onSlot = (page: number, index: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      e.stopPropagation();
      const box = e.currentTarget.getBoundingClientRect();
      aim({ page, index: e.clientX > box.left + box.width / 2 ? index + 1 : index });
    },
    onDrop: (e: DragEvent<HTMLElement>) => dropped(e, { page, index }),
  });
  /** Anywhere else on a page: the end of it. */
  const onGrid = (page: number, count: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      aim({ page, index: count });
    },
    onDrop: (e: DragEvent<HTMLElement>) => dropped(e, { page, index: count }),
  });

  const slot = (p: PanelPlace, page: number, index: number, count: number) => {
    const aimed = drop?.page === page ? drop.index : null;
    const classes = ['slot'];
    if (editing) classes.push('is-editing');
    if (dragging === p.id) classes.push('is-dragging');
    if (aimed === index) classes.push('drop-before');
    if (aimed === count && index === count - 1) classes.push('drop-after');
    return (
      <div
        key={p.id}
        id={p.id}
        className={classes.join(' ')}
        data-w={p.w}
        data-h={p.h}
        style={{ '--w': p.w, '--h': p.h } as CSSProperties}
        {...(editing
          ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLDivElement>) => {
            e.dataTransfer.setData(DRAG_TYPE, p.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragging(p.id);
          },
          onDragEnd: endDrag,
          ...onSlot(page, index),
        }
          : {})}
      >
        <div className="slot__body" inert={editing}>
          {PANELS[p.id]()}
        </div>
        {editing && (
          <SlotTools
            place={p}
            index={index}
            count={count}
            page={page}
            pageNames={pageNames}
            onWider={(step) => change(resizePanel(layout, p.id, { step }))}
            onHeight={(h) => change(resizePanel(layout, p.id, { h }))}
            onMove={(toPage, toIndex) => {
              place(p.id, toPage, toIndex);
              if (toPage !== page) pager.go(toPage);
            }}
            onHide={() => change(hidePanel(layout, p.id))}
          />
        )}
      </div>
    );
  };

  return (
    <>
      {/* The wallpaper is a layer of its own, fixed behind the page: the panels scroll over it and it stays put. */}
      <div className="backdrop" aria-hidden="true">
        <img
          className="photo backdrop__photo"
          src={wallpaper ?? DEFAULT_WALLPAPER}
          width={1920}
          height={1254}
          alt=""
          fetchPriority="high"
          onError={(e) => {
            if (!e.currentTarget.src.endsWith(DEFAULT_WALLPAPER)) e.currentTarget.src = DEFAULT_WALLPAPER;
          }}
        />
        <div className="backdrop__scrim" />
      </div>
      <div ref={pager.ref} className={['dash', pager.paged && 'is-paged', editing && 'is-editing'].filter(Boolean).join(' ')}>
        <div
          className="dash__track"
          data-leaning={pager.lean !== 0 ? '' : undefined}
          style={{ '--page': pager.page, '--lean': `${pager.lean}px` } as CSSProperties}
        >
          {layout.pages.map((page, i) => (
            <section
              key={i}
              className={i === 0 ? 'dash-page hero' : 'dash-page'}
              data-page={i}
              data-hero={i === 0 ? '' : undefined}
              aria-label={page.name}
            >
              {editing && (
                <PageHead
                  name={page.name}
                  first={i === 0}
                  onRename={(name) => change(renamePage(layout, i, name))}
                  onDelete={() => {
                    change(deletePage(layout, i));
                    pager.go(i - 1);
                  }}
                />
              )}
              {i === 0 && (
                <div className="container hero__grid">
                  <div id="hero-time" className="hero__time"><TimePanel /></div>
                  <div id="hero-agenda" className="hero__agenda"><TodayAgenda /></div>
                </div>
              )}
              <div className={i === 0 ? 'container dash-grid hero__panels' : 'container dash-grid'} {...(editing ? onGrid(i, page.panels.length) : {})}>
                {page.panels.map((p, index) => slot(p, i, index, page.panels.length))}
                {editing && page.panels.length === 0 && (
                  <p className={drop?.page === i ? 'dash-empty is-aimed' : 'dash-empty'}>
                    An empty page. Drag a panel here, or put one back from the hidden ones below.
                  </p>
                )}
              </div>
              {i === last && wallpaper === null && (
                <p className="container foot__credits">
                  Photograph:{' '}
                  <a href={PHOTO_SOURCE} target="_blank" rel="noreferrer">
                    Thomas Bresson
                  </a>{' '}
                  (CC BY 3.0), Wikimedia Commons
                </p>
              )}
            </section>
          ))}
        </div>

        {pager.paged && (
          <nav className="dash__dots" aria-label="Dashboard pages">
            {layout.pages.map((page, i) => (
              <button
                key={i}
                className={drop !== null && dragging !== null && pager.page !== i ? 'dash__dot is-target' : 'dash__dot'}
                type="button"
                aria-label={`Page ${i + 1}: ${page.name}`}
                aria-current={pager.page === i ? 'page' : undefined}
                onClick={() => pager.go(i)}
                // While dragging a panel, a dot is a way to its page: hover to turn, or drop to put it at the end.
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  aim({ page: i, index: layout.pages[i]!.panels.length });
                  if (dotTimer.current === null && pager.page !== i) {
                    dotTimer.current = setTimeout(() => {
                      dotTimer.current = null;
                      pager.go(i);
                    }, DOT_HOVER_MS);
                  }
                }}
                onDragLeave={() => {
                  if (dotTimer.current) clearTimeout(dotTimer.current);
                  dotTimer.current = null;
                }}
                onDrop={(e) => {
                  dropped(e, { page: i, index: layout.pages[i]!.panels.length });
                  pager.go(i);
                }}
              />
            ))}
          </nav>
        )}

        {editing ? (
          <EditBar
            hidden={hiddenPanels(layout)}
            canAdd={layout.pages.length < MAX_PAGES}
            failed={failed}
            onShow={(id) => place(id, pager.paged ? pager.page : last, Number.MAX_SAFE_INTEGER)}
            onDragHidden={(id) => (id === null ? endDrag() : setDragging(id))}
            onAddPage={() => {
              change(addPage(layout));
              pager.go(layout.pages.length);
            }}
            onReset={() => {
              reset();
              pager.go(0);
            }}
            onDone={() => setEditing(false)}
          />
        ) : (
          <button className="dash__edit" type="button" onClick={() => setEditing(true)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" />
              <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" />
              <rect x="1.5" y="9" width="13" height="5.5" rx="1.5" />
            </svg>
            Edit layout
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Under 700px the rail's timer rides just above the bottom bar; this reserves
 * its height on the page, so it covers nothing. Shares the current-session query,
 * so it costs no extra request.
 */
function reserveForTimer() {
  const { session } = useCurrentSession();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (session === null) delete root.dataset.timerRow;
    else root.dataset.timerRow = '1';
    return () => {
      delete root.dataset.timerRow;
    };
  }, [session]);
}
