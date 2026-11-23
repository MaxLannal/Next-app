import { useState } from 'react';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { formatDayKey } from '../../lib/format.ts';
import { messageOf } from './useSettings.ts';

type DataBackupsProps = {
  dataDir: string;
  lastBackupAt: string | null;
  /** Called after a backup so the newest day shows without a reload. */
  onBackedUp: () => void;
};

/** Where the data lives, when it was last backed up, and a backup on demand. */
export function DataBackups({ dataDir, lastBackupAt, onBackedUp }: DataBackupsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const backUp = async () => {
    setError(null);
    setBusy(true);
    try {
      await api<{ file: string }>('/api/settings/backup', { method: 'POST' });
      setSaved('Backed up just now');
      onBackedUp();
    } catch (err) {
      setError(messageOf(err, 'Couldn’t back up — retry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Data" className="settings-section">
      <dl className="facts">
        <div className="fact">
          <dt>Folder</dt>
          <dd>
            <code className="settings-path">{dataDir}</code>
          </dd>
        </div>
        <div className="fact">
          <dt>Last backup</dt>
          <dd>{formatDay(lastBackupAt)}</dd>
        </div>
      </dl>
      <p className="settings-note">
        The hub backs the database up once a day into one file per day, and keeps the newest 14. Attachments and the GitHub clone
        live in the same folder but aren’t copied.
      </p>
      <div className="settings-row">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void backUp()} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <span className="settings-status" role="status">
          {saved ?? ''}
        </span>
      </div>
      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** "22 Nov 2026" from a day key; "No backup yet" before the first. */
export function formatDay(day: string | null): string {
  return day === null ? 'No backup yet' : formatDayKey(day);
}
