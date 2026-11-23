import { useLayoutEffect, type ReactNode } from 'react';
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

/** Grid areas below the hero. Each later task puts its panel into its slot. */
type SlotId = 'goals' | 'focus' | 'heatmap' | 'sleep' | 'exercise' | 'calendar' | 'resources' | 'media';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

/**
 * The fog-valley hero (time on the pale fog, today's agenda in glass on the
 * dark side), then the panels on slate in two columns, one under 900px.
 */
export function Dashboard() {
  reserveForTimer();
  return (
    <>
      <section className="hero" data-hero aria-label="Today">
        <div className="hero__ground" aria-hidden="true">
          <img className="photo hero__photo" src="/photos/fog.jpg" width={1920} height={1254} alt="" fetchPriority="high" />
          <div className="hero__scrim" />
        </div>
        <div className="container hero__grid">
          <div id="hero-time" className="hero__time"><TimePanel /></div>
          <div id="hero-agenda" className="hero__agenda"><TodayAgenda /></div>
        </div>
      </section>

      <div className="container slate">
        <div className="slate__grid">
          <Slot id="goals">
            <GoalsPanel />
          </Slot>
          <Slot id="focus">
            <FocusPanel />
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
      </div>

      <footer className="container foot">
        <p className="foot__credits">
          Photograph:{' '}
          <a href={PHOTO_SOURCE} target="_blank" rel="noreferrer">
            Thomas Bresson
          </a>{' '}
          (CC BY 3.0), Wikimedia Commons
        </p>
      </footer>
    </>
  );
}

/**
 * Under 700px the nav's timer takes a fixed second row; this reserves its
 * height on the page, so it covers nothing. Shares the current-session query,
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
