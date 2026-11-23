import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import './LiquidAdder.css';

type LiquidAdderProps = {
  /** Saves what was typed; true when it saved, so the bar can close. */
  onAdd: (text: string) => Promise<boolean>;
  busy: boolean;
  /** The "+" button's name while closed, e.g. "Add a goal". */
  addLabel: string;
  /** Its name while open, e.g. "Close the new goal". */
  closeLabel: string;
  /** The field's name, e.g. "New goal". */
  fieldLabel: string;
  placeholder: string;
  /** How far the bar pours out, in px (it never leaves the window). */
  width?: number;
};

/**
 * A "+" that pours a type bar out to its left: a droplet runs ahead and the bar flows after it,
 * merged by a goo filter so the two read as one liquid. Enter adds what was typed and the bar
 * drains back into the "+"; Esc, or leaving it empty, closes it too. Goals and skills use it.
 */
export function LiquidAdder({ onAdd, busy, addLabel, closeLabel, fieldLabel, placeholder, width = 300 }: LiquidAdderProps) {
  const id = useId();
  const gooId = `${id.replace(/:/g, '')}-goo`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const plus = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const close = (focusPlus: boolean) => {
    setOpen(false);
    setDraft('');
    if (focusPlus) plus.current?.focus();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = draft.trim();
    if (title === '' || busy) return;
    if (await onAdd(title)) close(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div className={open ? 'adder is-open' : 'adder'} style={{ '--adder-max': `${width}px` } as CSSProperties}>
      <svg className="adder__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={gooId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      <div className="adder__liquid" style={{ filter: `url(#${gooId})` }} aria-hidden="true">
        <span className="adder__bar" />
        <span className="adder__drop" />
        <span className="adder__dot" />
      </div>
      <form className="adder__form" onSubmit={(e) => void submit(e)}>
        <label className="visually-hidden" htmlFor={id}>
          {fieldLabel}
        </label>
        <input
          ref={field}
          id={id}
          className="adder__field"
          type="text"
          enterKeyHint="done"
          autoComplete="off"
          placeholder={placeholder}
          value={draft}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          disabled={!open}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim() === '') close(false);
          }}
        />
      </form>
      <button
        ref={plus}
        className="adder__plus"
        type="button"
        aria-label={open ? closeLabel : addLabel}
        aria-expanded={open}
        aria-controls={id}
        // Keeps the field's blur from closing the bar before this click toggles it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
