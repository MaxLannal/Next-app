import { useRef, useState, type ChangeEvent } from 'react';
import type { SettingsView } from '@shared/types.ts';
import { api } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { CopyField } from './CopyField.tsx';
import { messageOf } from './useSettings.ts';

/** `POST /api/ingest/health-export` (Task 12): how many samples it added. */
type ImportResult = { inserted: number };

/** The Shortcut, step by step, then the URL and token it needs and the one-off history import. */
export function SleepSetup({ settings }: { settings: SettingsView }) {
  const token = settings.hubToken;
  return (
    <Panel title="Sleep" className="settings-section">
      <p className="settings-lead">
        An automation on the iPhone sends the last seven days of Apple Health sleep each morning. Overlapping days are fine: the hub
        de-duplicates them and prefers the Watch for each night.
      </p>

      <ol className="steps steps--numbers">
        <li>In the Shortcuts app, open Automation and add a Personal Automation, Daily at the time you wake.</li>
        <li>Add Find Health Samples, with Sleep Analysis samples whose Start Date is in the last 7 days.</li>
        <li>
          Add Repeat with Each. Inside it, Format Date twice (Start Date and End Date, Date Format: ISO 8601), then Text:{' '}
          <code>{'{"start":"[start]","end":"[end]","value":"[Value]","source":"[Source]"}'}</code>
        </li>
        <li>
          After the repeat, add Combine Text with <code>,</code> and wrap it in <code>[ ]</code>, so the body is one JSON list.
          Lines of <code>start;end;value;source</code> work too, and so do Health’s Chinese stage names and dates.
        </li>
        <li>
          Add Get Contents of URL: method POST (Request Body: File), header <code>Authorization</code> ={' '}
          <code>Bearer {token === undefined ? '<token>' : token}</code>, and the combined text as the body, sent to the address
          below.
        </li>
        <li>
          Add Show Result after it while you test: Shortcuts doesn’t treat a refused upload as an error, so this is where the
          hub’s reply shows. The dashboard’s Sleep panel says so too.
        </li>
        <li>Turn off Ask Before Running, so it sends without a tap.</li>
      </ol>

      <CopyField
        label="URL for Get Contents of URL"
        value={settings.ingestUrl}
        emptyLine="This Mac is on no network — connect to Wi-Fi or start Tailscale, then reload"
      />
      <CopyField
        label="Hub token"
        value={token ?? ''}
        emptyLine="Open Settings on the Mac to see the token; it never goes to the phone"
      >
        {token === undefined && <p className="settings-note">The token shows only when Settings is open on this Mac.</p>}
      </CopyField>

      <HistoryImport />
    </Panel>
  );
}

/** Apple Health's export (the zip or its export.xml), uploaded once to backfill the nights before the Shortcut existed. */
function HistoryImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      setResult(await api<ImportResult>('/api/ingest/health-export', { method: 'POST', body }));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t read that export — try again'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="import">
      <p className="settings-note">
        Past nights, once: in Health, tap your picture, Export All Health Data, and pick the export (the .zip, or the .xml inside it)
        here.
      </p>
      <div className="import__row">
        <label className="btn btn-ghost" htmlFor="sleep-import">
          {busy ? 'Reading…' : 'Upload a Health export'}
        </label>
        <input
          ref={inputRef}
          id="sleep-import"
          className="visually-hidden"
          type="file"
          accept=".xml,.zip,application/xml,text/xml,application/zip"
          disabled={busy}
          onChange={(e) => void upload(e)}
        />
        <span className="settings-status" role="status">
          {result !== null ? `Added ${result.inserted} ${result.inserted === 1 ? 'sample' : 'samples'}` : ''}
        </span>
      </div>
      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
