import { useState, type FormEvent } from 'react';
import type { SettingsView } from '@shared/types.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { CopyField } from './CopyField.tsx';
import { Switch } from './Switch.tsx';
import { messageOf, savedAt, type SettingsPatch } from './useSettings.ts';

type PhoneAccessProps = {
  settings: SettingsView;
  onSave: (patch: SettingsPatch) => Promise<SettingsView>;
};

const MIN_PASSCODE = 6;

/** The phone over Tailscale: what to install, the address to open, the passcode and keep-awake. */
export function PhoneAccess({ settings, onSave }: PhoneAccessProps) {
  const host = settings.ingestHost;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');

  const changeKeepAwake = async (on: boolean) => {
    setError(null);
    setSaving(true);
    try {
      await onSave({ keepAwake: on });
      setSaved(savedAt(new Date()));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t change keep-awake — retry'));
    } finally {
      setSaving(false);
    }
  };

  const changePasscode = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (passcode.length < MIN_PASSCODE) {
      setError(`A passcode needs ${MIN_PASSCODE} characters or more`);
      return;
    }
    if (passcode !== confirm) {
      setError('The two passcodes don’t match');
      return;
    }
    setSaving(true);
    try {
      await onSave({ passcode });
      setPasscode('');
      setConfirm('');
      setSaved(savedAt(new Date()));
    } catch (err) {
      setError(messageOf(err, 'Couldn’t set the passcode — retry'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Phone access" className="settings-section">
      <ol className="steps">
        <li>Install Tailscale on this Mac and on your iPhone, and sign in to both with the same account.</li>
        <li>
          On the iPhone, open the Mac’s Tailscale address in Safari. Add it to the Home Screen for an app-like window.
        </li>
        <li>Enter the passcode once. The phone remembers it.</li>
      </ol>

      <CopyField
        label="Address to open on the iPhone"
        value={host === null ? '' : `http://${host}:4747`}
        emptyLine="This Mac is on no network — connect to Wi-Fi or start Tailscale"
      >
        {host !== null && !settings.tailscale && (
          <p className="settings-note">
            Tailscale isn’t answering, so this is the local network address. It works while the iPhone is on the same Wi-Fi.
          </p>
        )}
      </CopyField>

      <p className="settings-status">
        {settings.hasPasscode ? 'A passcode is set.' : 'No passcode yet — the phone can’t log in until one is set.'}
      </p>

      <form className="passcode" onSubmit={(e) => void changePasscode(e)}>
        <label className="field">
          <span className="field__label">Passcode</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSCODE}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="At least 6 characters"
          />
        </label>
        <label className="field">
          <span className="field__label">Repeat passcode</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {settings.hasPasscode ? 'Change passcode' : 'Set passcode'}
        </button>
      </form>
      <p className="settings-note">The passcode is changed on the Mac only, so the phone can’t lock you out.</p>

      <Switch
        label="Keep the Mac awake while plugged in"
        checked={settings.keepAwake}
        disabled={saving}
        onChange={(on) => void changeKeepAwake(on)}
        hint="Runs caffeinate, so the hub answers while the hub is open. The phone still needs the Mac awake otherwise."
      />

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
