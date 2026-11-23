import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, ApiError, LOGIN_REQUIRED_EVENT, queryClient } from '../api.ts';
import { Sheet } from './ui/Sheet.tsx';

/**
 * Asks for the hub passcode when the server answers 401 (a phone or another
 * device; this Mac never needs it). On success the cookie is set and every
 * query refetches.
 */
export function LoginGate() {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(LOGIN_REQUIRED_EVENT, show);
    return () => window.removeEventListener(LOGIN_REQUIRED_EVENT, show);
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', json: { passcode } });
      setOpen(false);
      setPasscode('');
      void queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t sign in — retry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Enter the hub passcode">
      <form className="login" onSubmit={submit}>
        <p className="login__line">This device asks once. You set the passcode in Settings on the Mac.</p>
        {/* Lets password managers file the passcode under one name. */}
        <input type="text" name="username" autoComplete="username" value="Hub" readOnly hidden />
        <div className="join">
          <label className="visually-hidden" htmlFor={inputId}>
            Passcode
          </label>
          <input
            id={inputId}
            data-autofocus
            type="password"
            autoComplete="current-password"
            placeholder="Passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || passcode === ''}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
        {error !== null && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
