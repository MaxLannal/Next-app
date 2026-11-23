import { useState, type FormEvent } from 'react';
import type { GitStatus } from '@shared/types.ts';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { messageOf } from './useSettings.ts';

const OWNER_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The private repository the hub syncs with: connect it, see where it stands, sync now. */
export function GitHubSetup({ github }: { github: GitStatus }) {
  // The default names the usual private journal; Connect creates it if it's missing.
  const [repo, setRepo] = useState(github.repo ?? 'work-journal');
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [status, setStatus] = useState<GitStatus>(github);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const valid = OWNER_NAME.test(repo.trim());

  const connect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy('connect');
    try {
      const next = await api<GitStatus>('/api/github/connect', { method: 'POST', json: { repo: repo.trim() } });
      setStatus(next);
      if (!next.configured) setError('Couldn’t clone that repository — check the name and that gh is signed in');
      else setSaved('Connected');
    } catch (err) {
      setError(messageOf(err, 'Couldn’t connect — check the name and that gh is signed in'));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setError(null);
    setBusy('sync');
    try {
      setStatus(await api<GitStatus>('/api/github/sync', { method: 'POST' }));
    } catch {
      setError('Couldn’t sync — retry');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="GitHub" className="settings-section">
      <p className="settings-lead">
        Code, notes and essays sync both ways with a private repository. Photos and PDFs stay on this Mac. The hub uses{' '}
        <code>gh</code>’s login, so sign in with <code>gh auth login</code> first; setup creates the repository if it isn’t there.
      </p>

      <form className="join" onSubmit={(e) => void connect(e)}>
        <label className="visually-hidden" htmlFor="github-repo">
          Repository, as owner/name
        </label>
        <input
          id="github-repo"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="owner/work-journal"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!valid || busy !== null}>
          {status.configured ? 'Reconnect' : 'Connect'}
        </button>
      </form>
      <p className="settings-note">
        The name looks like owner/name. Put an existing private repository here, or a name your account doesn’t have yet and
        Connect creates it.
      </p>

      <dl className="facts">
        <div className="fact">
          <dt>Repository</dt>
          <dd>{status.repo ?? 'Not connected'}</dd>
        </div>
        <div className="fact">
          <dt>Last synced</dt>
          <dd>{formatWhen(status.lastSyncAt)}</dd>
        </div>
        <div className="fact">
          <dt>Waiting to push</dt>
          <dd className="num">
            {status.pending} {status.pending === 1 ? 'file' : 'files'}
          </dd>
        </div>
      </dl>
      <div className="settings-row">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void sync()} disabled={!status.configured || busy !== null}>
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
        {status.lastError !== null && <p className="settings-risk">Last synced {formatWhen(status.lastSyncAt)} · {status.lastError}</p>}
      </div>

      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <p className="settings-saved" role="status">
        {saved ?? ''}
      </p>
    </Panel>
  );
}

/** The time alone when it was today, else the short day before it; "Never" before the first sync. */
export function formatWhen(iso: string | null, now = new Date()): string {
  if (iso === null) return 'Never';
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}, ${time}`;
}
