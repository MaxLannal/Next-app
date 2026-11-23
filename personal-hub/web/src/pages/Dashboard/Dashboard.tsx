import type { ReactNode } from 'react';
import { Panel } from '../../components/ui/Panel.tsx';
import { ResourcesPanel } from './resources/ResourcesPanel.tsx';
import { SleepPanel } from './sleep/SleepPanel.tsx';

/** Grid areas below the hero. Each later task puts its panel into its slot. */
type SlotId = 'goals' | 'focus' | 'heatmap' | 'sleep' | 'exercise' | 'calendar' | 'resources' | 'media';

const PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Vallee-brouillard.jpg';

/**
 * The fog-valley hero (time on the pale fog, today's agenda in glass on the
 * dark side), then the panels on slate in two columns, one under 900px.
 */
export function Dashboard() {
  return (
    <>
      <section className="hero" data-hero aria-label="Today">
        <div className="hero__ground" aria-hidden="true">
          <img className="photo hero__photo" src="/photos/fog.jpg" width={1920} height={1254} alt="" fetchPriority="high" />
          <div className="hero__scrim" />
        </div>
        <div className="container hero__grid">
          <div id="hero-time" className="hero__time" />
          <div id="hero-agenda" className="hero__agenda" />
        </div>
      </section>

      <div className="container slate">
        <div className="slate__grid">
          <Slot id="goals">
            <Panel title="Goals" />
          </Slot>
          <Slot id="focus">
            <Panel title="Focus" />
          </Slot>
          <Slot id="heatmap">
            <Panel title="Year of focus" />
          </Slot>
          <Slot id="sleep">
            <SleepPanel />
          </Slot>
          <Slot id="exercise">
            <Panel title="Push-ups and squats" />
          </Slot>
          <Slot id="calendar">
            <Panel title="Calendar" />
          </Slot>
          <Slot id="resources">
            <ResourcesPanel />
          </Slot>
          <Slot id="media">
            <Panel title="Now playing" />
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

function Slot({ id, children }: { id: SlotId; children: ReactNode }) {
  return (
    <div id={id} className="slot" style={{ gridArea: id }}>
      {children}
    </div>
  );
}
