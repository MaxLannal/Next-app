import { useEffect, useId, useRef, useState } from 'react';

type AddMenuProps = { onStep: () => void; onExperience: () => void };

/**
 * The canvas's "+". Pressed, two drops of liquid pour out of it and settle as "Step" and
 * "Experience", merged with the "+" by a goo filter on the way. Choosing one, Esc, or a click
 * elsewhere pours them back.
 */
export function AddMenu({ onStep, onExperience }: AddMenuProps) {
  const [open, setOpen] = useState(false);
  const gooId = `${useId().replace(/:/g, '')}-goo`;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = (act: () => void) => {
    setOpen(false);
    act();
  };

  return (
    <div ref={root} className={open ? 'addmenu is-open' : 'addmenu'}>
      <svg className="addmenu__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={gooId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      <div className="addmenu__liquid" style={{ filter: `url(#${gooId})` }} aria-hidden="true">
        <span className="addmenu__blob addmenu__blob--step" />
        <span className="addmenu__blob addmenu__blob--exp" />
        <span className="addmenu__core" />
      </div>
      <button className="addmenu__opt addmenu__opt--step" type="button" tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={() => choose(onStep)}>
        Step
      </button>
      <button className="addmenu__opt addmenu__opt--exp" type="button" tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={() => choose(onExperience)}>
        Experience
      </button>
      <button className="addmenu__plus" type="button" aria-label={open ? 'Close the add menu' : 'Add to the canvas'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
