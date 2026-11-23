import { useRef, useState, type ChangeEvent } from 'react';
import type { SettingsView } from '@shared/types.ts';
import { api, ApiError } from '../../api.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { CopyField } from './CopyField.tsx';
import { messageOf } from './useSettings.ts';

type ImportResult = { imported: number; nights: number };

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
          Add Repeat with Each, and inside it Text: <code>[Start Date ISO];[End Date ISO];[Value];[Source]</code>
        </li>
        <li>After the repeat, add Combine Text with New Lines, so each sample is one line.</li>
        <li>
          Add Get Contents of URL: method POST (Request Body: File), header <code>Authorization</code> ={' '}
          <code>Bearer {token === undefined ? '<token>' : token}</code>, and the combined text as the body, sent to the address
          below.
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

/** Apple Health's export.xml, uploaded once to backfill the nights before the Shortcut existed. */
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
      setResult(await api<ImportResult>('/api/health/import', { method: 'POST', body }));
    } catch (err) {
      // The import endpoint is Task 12's; until it lands, say so plainly.
      const notThere = err instanceof ApiError && (err.status === 404 || err.status === 405);
      setError(
        notThere
          ? 'The history import isn’t part of this build yet — the Shortcut alone fills the nights from today on.'
          : messageOf(err, 'Couldn’t read that export — try again'),
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="import">
      <p className="settings-note">Past nights, once: in Health, tap your picture, Export All Health Data, and pick the export.xml here.</p>
      <div className="import__row">
        <label className="btn btn-ghost" htmlFor="sleep-import">
          {busy ? 'Reading…' : 'Upload export.xml'}
        </label>
        <input
          ref={inputRef}
          id="sleep-import"
          className="visually-hidden"
          type="file"
          accept=".xml,application/xml,text/xml"
          disabled={busy}
          onChange={(e) => void upload(e)}
        />
        <span className="settings-status" role="status">
          {result !== null ? `Read ${result.imported} samples into ${result.nights} nights` : ''}
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
