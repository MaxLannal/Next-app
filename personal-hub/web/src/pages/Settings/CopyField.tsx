import { useRef, useState, type ReactNode } from 'react';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type CopyFieldProps = {
  label: string;
  value: string;
  /** Shown when the value is empty, in the field's place. */
  emptyLine?: string;
  /** Under the field, e.g. why the token is missing on the phone. */
  children?: ReactNode;
};

/**
 * A value in a smoked pill with Copy beside it. The value is readable text, not
 * a field, so it copies by selection as well as by the button. A token is only
 * present when the page was opened on the Mac itself.
 */
export function CopyField({ label, value, emptyLine, children }: CopyFieldProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const reset = useRef<number | undefined>(undefined);

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(reset.current);
    reset.current = window.setTimeout(() => setState('idle'), 2400);
  };

  return (
    <div className="copy-field">
      <p className="copy-field__label">{label}</p>
      <div className="copy-field__row">
        <code className="copy-field__value">{value !== '' ? value : (emptyLine ?? 'Not known yet')}</code>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void copy()} disabled={value === ''}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
        </button>
      </div>
      <p className="visually-hidden" role="status">
        {state === 'copied' ? `${label} copied` : state === 'failed' ? `Couldn’t copy ${label} — select it and copy` : ''}
      </p>
      {children}
    </div>
  );
}
