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
import { SkillTrackerPanel } from './skills/SkillTrackerPanel.tsx';

/** Grid areas: goals and focus sit on the painting, the rest on slate below it. */
type SlotId = 'goals' | 'focus' | 'skills' | 'heatmap' | 'sleep' | 'exercise' | 'calendar' | 'resources' | 'media';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

/**
 * The fog-valley hero: time on the pale fog, today's agenda in glass on the
 * dark side, and Goals and Focus in glass on the painting below them. Then the
 * slate, opening with the skill tracker beside the year of focus (a third and two
 * thirds); six even tracks, one column under 900px.
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
        <div className="container hero__panels">
          <Slot id="goals">
            <GoalsPanel />
          </Slot>
          <Slot id="focus">
            <FocusPanel />
          </Slot>
        </div>
      </section>

      <div className="container slate">
        <div className="slate__grid">
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
