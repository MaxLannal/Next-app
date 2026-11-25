import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  addPage,
  baseOf,
  copyPanel,
  COPYABLE,
  deletePage,
  hiddenPanels,
  hidePanel,
  MAX_PAGES,
  placePanel,
  renamePage,
  showPanel,
  type PanelId,
  type PanelRect,
} from '@shared/layout.ts';
import { useCurrentSession } from './focus/useSessions.ts';
import { ResourcesPanel } from './resources/ResourcesPanel.tsx';
import { CalendarPanel } from './calendar/CalendarPanel.tsx';
import { TimePanel } from './time/TimePanel.tsx';
import { ExercisePanel } from './exercise/ExercisePanel.tsx';
import { NowPlayingPanel } from './media/NowPlayingPanel.tsx';
import { YearOfFocusPanel } from './heatmap/YearOfFocusPanel.tsx';
import { SleepPanel } from './sleep/SleepPanel.tsx';
import { FocusPanel } from './focus/FocusPanel.tsx';
import { GoalsPanel } from './goals/GoalsPanel.tsx';
import { SkillTrackerPanel } from './skills/SkillTrackerPanel.tsx';
import { ReviewPanel } from './review/ReviewPanel.tsx';
import { DayTimeline } from './timeline/DayTimeline.tsx';
import { DEFAULT_WALLPAPER, useWallpaper } from '../../lib/useWallpaper.ts';
import { EditBar, PageHead, SlotTools } from './EditLayout.tsx';
import { useArrange } from './useArrange.ts';
import { useLayout } from './useLayout.ts';
import { usePager } from './usePager.ts';
import './pages.css';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

const PANELS: Record<PanelId, () => ReactNode> = {
  time: () => (
    <div className="hero__time">
      <TimePanel />
    </div>
  ),
  agenda: () => (
    <div className="hero__agenda">
      <DayTimeline />
    </div>
  ),
  goals: () => <GoalsPanel />,
  focus: () => <FocusPanel />,
  skills: () => <SkillTrackerPanel />,
  heatmap: () => <YearOfFocusPanel />,
  sleep: () => <SleepPanel />,
  exercise: () => <ExercisePanel />,
  calendar: () => <CalendarPanel />,
  resources: () => <ResourcesPanel />,
  media: () => <NowPlayingPanel />,
  review: () => <ReviewPanel />,
};

/** Top to bottom, then left to right: the order a page reads in, and its panels stack in on a phone. */
const reading = (a: PanelRect, b: PanelRect) => a.y - b.y || a.x - b.x;

/**
 * The dashboard's pages over the wallpaper, each a whole screen, turned with some force
 * (usePager). Where every panel sits, the clock and agenda included, is the layout (useLayout):
 * arranged by hand in edit mode (useArrange), where a panel drags anywhere on its page or onto
 * another and its edges drag to size it, and pages are added, named and deleted. A small window
 * scrolls through the pages as one; on a phone each page's panels stack in reading order.
 */
export function Dashboard() {
  reserveForTimer();
  // The wallpaper chosen in Settings, else the fog photograph (which alone needs its credit).
  const wallpaper = useWallpaper();
  const { layout, change, reset, failed } = useLayout();
  const pager = usePager(layout.pages.length);
  const [editing, setEditing] = useState(false);
  const arrange = useArrange(layout, change, pager);
  const shown = arrange.preview;
  const drag = arrange.drag;
  const last = shown.pages.length - 1;
  const pageNames = shown.pages.map((p) => p.name);

  // Esc leaves edit mode (unless a sheet is open, or a drag is under way: Esc is theirs).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || drag || document.querySelector('[role="dialog"]') || e.target instanceof HTMLInputElement) return;
      setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, drag]);

  const slot = (p: PanelRect, page: number, media: PanelRect | undefined) => {
    const lifted = drag?.id === p.id && drag.moved ? drag.lifted : null;
    const classes = ['slot', `slot--${baseOf(p.id)}`];
    if (editing) classes.push('is-editing');
    if (lifted) classes.push('is-lifted');
    if (drag?.id === p.id && drag.kind === 'resize') classes.push('is-sizing');
    const style = { '--x': p.x, '--y': p.y, '--w': p.w, '--h': p.h } as CSSProperties;
    // Now playing draws nothing with nothing playing; the panel right above it, as wide, takes its rows then.
    const grows = media !== undefined && media.id !== p.id && media.x === p.x && media.w === p.w && media.y === p.y + p.h;
    if (grows) Object.assign(style, { '--grown': p.h + media.h });
    if (lifted) Object.assign(style, { left: lifted.left, top: lifted.top, width: lifted.width, height: lifted.height });
    return (
      <div
        key={p.id}
        id={p.id}
        className={classes.join(' ')}
        style={style}
        data-grows={grows ? '' : undefined}
        onPointerDown={editing ? (e) => arrange.press(e, p.id) : undefined}
      >
        <div className="slot__body" inert={editing}>
          {PANELS[baseOf(p.id)]()}
        </div>
        {editing && (
          <SlotTools
            id={p.id}
            page={page}
            pageNames={pageNames}
            onPress={(e, edges) => arrange.press(e, p.id, edges)}
            onNudge={(e) => arrange.nudge(e, p.id)}
            onPage={(to) => {
              change(placePanel(layout, p.id, to, p));
              pager.go(to);
            }}
            onCopy={
              COPYABLE.includes(baseOf(p.id))
                ? (to) => {
                    change(copyPanel(layout, p.id, to));
                    pager.go(to);
                  }
                : undefined
            }
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
      <div
        ref={pager.ref}
        className={['dash', pager.paged && 'is-paged', editing && 'is-editing', drag?.moved && 'is-dragging'].filter(Boolean).join(' ')}
      >
        <div
          className="dash__track"
          data-leaning={pager.lean !== 0 ? '' : undefined}
          style={{ '--page': pager.page, '--lean': `${pager.lean}px` } as CSSProperties}
        >
          {shown.pages.map((page, i) => (
            <section key={i} className="dash-page" data-page={i} data-hero={i === 0 ? '' : undefined} aria-label={page.name}>
              {editing && !pager.paged && (
                <PageHead
                  name={page.name}
                  canDelete={layout.pages.length > 1}
                  onRename={(name) => change(renamePage(layout, i, name))}
                  onDelete={() => {
                    change(deletePage(layout, i));
                    pager.go(Math.max(0, i - 1));
                  }}
                />
              )}
              <div className="dash-canvas">
                {[...page.panels].sort(reading).map((p) => slot(p, i, page.panels.find((x) => x.id === 'media')))}
                {drag?.moved && drag.page === i && (
                  <div className="slot-ghost" style={{ '--x': drag.rect.x, '--y': drag.rect.y, '--w': drag.rect.w, '--h': drag.rect.h } as CSSProperties} />
                )}
                {editing && page.panels.length === 0 && !drag && (
                  <p className="dash-empty">An empty page. Drag a panel here, or put one back from the hidden ones below.</p>
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
            {shown.pages.map((page, i) => (
              <button
                key={i}
                className="dash__dot"
                type="button"
                data-index={i}
                aria-label={`Page ${i + 1}: ${page.name}`}
                aria-current={pager.page === i ? 'page' : undefined}
                onClick={() => pager.go(i)}
              />
            ))}
          </nav>
        )}

        {editing ? (
          <EditBar
            page={
              pager.paged && layout.pages[pager.page]
                ? {
                    name: layout.pages[pager.page]!.name,
                    canDelete: layout.pages.length > 1,
                    onRename: (name) => change(renamePage(layout, pager.page, name)),
                    onDelete: () => {
                      change(deletePage(layout, pager.page));
                      pager.go(Math.max(0, pager.page - 1));
                    },
                  }
                : undefined
            }
            hidden={hiddenPanels(layout)}
            canAdd={layout.pages.length < MAX_PAGES}
            failed={failed}
            onPressHidden={arrange.pressHidden}
            onShow={(id) => change(showPanel(layout, id, pager.page))}
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
