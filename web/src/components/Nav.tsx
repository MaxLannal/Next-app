import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { nextMarkSvg } from '@shared/next-mark.ts';
import './Nav.css';

/**
 * The Next logo, drawn once. As an image its gradients and clips keep their ids to themselves; its
 * plate is shaded in 3° steps, which at this size reads as smooth as the app icon's 1°.
 */
const MARK = `data:image/svg+xml,${encodeURIComponent(nextMarkSvg({ sweepStep: 3 }))}`;

type NavProps = {
  /** The running-timer pill, shown on every page while a session is active. */
  timerSlot?: ReactNode;
};

/**
 * The side rail: the Next logo, one icon per page, and Settings at the foot. The page you're on
 * wears a pill that runs to the rail's edge, with the periwinkle dot that means "on". Each icon
 * names itself on hover and focus. Under 700px the rail becomes a bar along the bottom.
 */
export function Nav({ timerSlot }: NavProps) {
  return (
    <aside className="rail">
      <Link className="rail__brand" to="/" aria-label="Next, dashboard">
        <img className="rail__mark" src={MARK} alt="" draggable={false} />
      </Link>
      <nav className="rail__links" aria-label="Main">
        <RailLink to="/" end label="Dashboard" icon={<GaugeIcon />} />
        <RailLink to="/essays" label="Essays" icon={<PenIcon />} />
        <RailLink to="/database" label="Database" icon={<DatabaseIcon />} />
        <RailLink to="/skills" label="Skills" icon={<PyramidIcon />} />
        <RailLink to="/traces" label="Traces" icon={<GlobeIcon />} />
      </nav>
      <div className="rail__end">
        {timerSlot}
        <RailLink to="/settings" label="Settings" icon={<GearIcon />} />
      </div>
    </aside>
  );
}

function RailLink({ to, end, label, icon }: { to: string; end?: boolean; label: string; icon: ReactNode }) {
  return (
    <NavLink className="rail__link" to={to} end={end} aria-label={label}>
      {icon}
      <span className="rail__tip" aria-hidden="true">
        {label}
      </span>
    </NavLink>
  );
}

/** The icons share one 24px grid, a 1.75 stroke and round ends. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="rail__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Dashboard: a dial with its needle — the day at a glance. */
function GaugeIcon() {
  return (
    <Icon>
      <path d="M3.5 16.5a8.5 8.5 0 0 1 17 0" />
      <path d="M6.6 10.6l1.1 1.1M12 8v1.5M17.4 10.6l-1.1 1.1" />
      <path d="M12 16.5l4-4.4" />
      <circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Essays: a pen on the line it is writing. */
function PenIcon() {
  return (
    <Icon>
      <path d="M15.2 4.3a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L10 18.5l-4.8 1.1 1.1-4.8z" />
      <path d="M13.6 5.9l4.5 4.5" />
      <path d="M13 20h7" />
    </Icon>
  );
}

/** Database: the stacked cylinder every session, file and note is kept in. */
function DatabaseIcon() {
  return (
    <Icon>
      <ellipse cx="12" cy="5.8" rx="7" ry="2.8" />
      <path d="M5 5.8v6.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V5.8" />
      <path d="M5 12v6.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V12" />
    </Icon>
  );
}

/** Skills: a pyramid of stages, climbed from the foundations up. */
function PyramidIcon() {
  return (
    <Icon>
      <path d="M12 3.5L21 20H3z" />
      <path d="M7.4 12h9.2M5.2 16h13.6" />
    </Icon>
  );
}

/** Traces: a globe with a pin on it. */
function GlobeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z" />
    </Icon>
  );
}

/** Settings: a gear. */
function GearIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8l1.6 2.3 2.7-.7.7 2.7 2.3 1.6-1.2 2.5 1.2 2.5-2.3 1.6-.7 2.7-2.7-.7L12 21.2l-1.6-2.3-2.7.7-.7-2.7-2.3-1.6 1.2-2.5-1.2-2.5 2.3-1.6.7-2.7 2.7.7z" />
    </Icon>
  );
}
