import type { SettingsView } from '@shared/types.ts';
import { Panel } from '../../components/ui/Panel.tsx';

type State = { label: string; tone: 'on' | 'off' | 'missing'; fix: string | null };

const CALENDAR: Record<SettingsView['calendar'], State> = {
  granted: { label: 'Granted', tone: 'on', fix: null },
  denied: {
    label: 'Not granted',
    tone: 'off',
    fix: 'Open System Settings → Privacy & Security → Calendars and turn Hub on. If Hub isn’t listed, run npm run setup once more; it asks there.',
  },
  missing: {
    label: 'Helper not built',
    tone: 'missing',
    fix: 'The Calendar helper isn’t built. Run bash scripts/build-helpers.sh (or npm run setup) in the hub folder, then reload.',
  },
};

const MEDIA: Record<SettingsView['media'], State> = {
  ready: { label: 'Ready', tone: 'on', fix: null },
  'no-accessibility': {
    label: 'Needs Accessibility',
    tone: 'off',
    fix: 'Open System Settings → Privacy & Security → Accessibility, click +, and add the hub folder. Media controls then work; until then they stay hidden.',
  },
  missing: {
    label: 'Helper not built',
    tone: 'missing',
    fix: 'The media helper isn’t built. Run bash scripts/build-helpers.sh (or npm run setup) in the hub folder, then reload.',
  },
};

/** Calendar and media access, each with what a fix takes. */
export function Permissions({ settings }: { settings: SettingsView }) {
  return (
    <Panel title="Permissions" className="settings-section">
      <ul className="perms">
        <Permission name="Calendar" state={CALENDAR[settings.calendar]} />
        <Permission name="Media controls" state={MEDIA[settings.media]} />
      </ul>
    </Panel>
  );
}

function Permission({ name, state }: { name: string; state: State }) {
  return (
    <li className="perm">
      <div className="perm__head">
        <span className="perm__name">{name}</span>
        <span className={`perm__state perm__state--${state.tone}`}>{state.label}</span>
      </div>
      {state.fix !== null && <p className="perm__fix">{state.fix}</p>}
    </li>
  );
}
