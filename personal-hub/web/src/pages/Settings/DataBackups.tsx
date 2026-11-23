import { useState } from 'react';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
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
        The hub backs up once a day and keeps the last 14. A backup copies everything in the folder: the database, attachments and
        the repository.
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

/** "Nov 22, 2026" from a day key; "No backup yet" before the first. */
export function formatDay(day: string | null): string {
  if (day === null) return 'No backup yet';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
