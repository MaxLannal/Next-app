import { useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { useCurrentSession } from './focus/useSessions.ts';
import { Panel } from '../../components/ui/Panel.tsx';
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
import { usePager } from './usePager.ts';
import './pages.css';

/** Grid areas: goals and focus on the first page, then the progress and the plans pages. */
type SlotId = 'goals' | 'focus' | 'skills' | 'heatmap' | 'sleep' | 'exercise' | 'calendar' | 'resources' | 'media';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

/** The dashboard's three pages, in order. */
const PAGES = ['Today', 'Progress', 'Plans'] as const;

/**
 * Three pages over the wallpaper, each a whole screen, turned with some force (usePager): Today
 * (the time, today's agenda, Goals and Focus), Progress (the skill tracker beside the year of
 * focus, then sleep and exercise) and Plans (the calendar beside resources and what's playing).
 * Dots on the right say which is showing. A small window scrolls through them as one page.
 */
export function Dashboard() {
  reserveForTimer();
  // The wallpaper chosen in Settings, else the fog photograph (which alone needs its credit).
  const wallpaper = useWallpaper();
  const pager = usePager(PAGES.length);
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
      <div ref={pager.ref} className={pager.paged ? 'dash is-paged' : 'dash'}>
        <div
          className="dash__track"
          data-leaning={pager.lean !== 0 ? '' : undefined}
          style={{ '--page': pager.page, '--lean': `${pager.lean}px` } as CSSProperties}
        >
          <section className="dash-page hero" data-page="0" data-hero aria-label="Today">
            <div className="container hero__grid">
              <div id="hero-time" className="hero__time"><TimePanel /></div>
              <div id="hero-agenda" className="hero__agenda"><TodayAgenda /></div>
            </div>
            <div className="container hero__panels">
              <Slot id="goals">
                <GoalsPanel />
              </Slot>
              <Slot id="focus">
                <FocusPanel />
              </Slot>
            </div>
          </section>

          <section className="dash-page" data-page="1" aria-label="Progress">
            <div className="container dash-grid dash-grid--progress">
              <Slot id="skills">
                <SkillTrackerPanel />
              </Slot>
              <Slot id="heatmap">
                <YearOfFocusPanel />
              </Slot>
              <Slot id="sleep">
                <SleepPanel />
              </Slot>
              <Slot id="exercise">
                <ExercisePanel />
              </Slot>
            </div>
          </section>

          <section className="dash-page" data-page="2" aria-label="Plans">
            <div className="container dash-grid dash-grid--plans">
              <Slot id="calendar">
                <CalendarPanel />
              </Slot>
              <Slot id="resources">
                <ResourcesPanel />
              </Slot>
              <Slot id="media">
                <NowPlayingPanel />
              </Slot>
            </div>
            {wallpaper === null && (
              <p className="container foot__credits">
                Photograph:{' '}
                <a href={PHOTO_SOURCE} target="_blank" rel="noreferrer">
                  Thomas Bresson
                </a>{' '}
                (CC BY 3.0), Wikimedia Commons
              </p>
            )}
          </section>
        </div>

        {pager.paged && (
          <nav className="dash__dots" aria-label="Dashboard pages">
            {PAGES.map((name, i) => (
              <button
                key={name}
                className="dash__dot"
                type="button"
                aria-label={`Page ${i + 1}: ${name}`}
                aria-current={pager.page === i ? 'page' : undefined}
                onClick={() => pager.go(i)}
              />
            ))}
          </nav>
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

function Slot({ id, children }: { id: SlotId; children: ReactNode }) {
  return (
    <div id={id} className="slot" style={{ gridArea: id }}>
      {children}
    </div>
  );
}
