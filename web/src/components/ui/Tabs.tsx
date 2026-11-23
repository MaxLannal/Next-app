import { useRef, type KeyboardEvent } from 'react';

export type TabOption = { value: string; label: string };

type TabsProps = {
  options: TabOption[];
  value: string;
  onChange: (value: string) => void;
  /** Names the tab list for screen readers. */
  label: string;
};

/**
 * Dusk tabs: a ruled row of words with a periwinkle dot on the active one,
 * never boxed segments. Arrow keys, Home and End move the selection.
 */
export function Tabs({ options, value, onChange, label }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    refs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' ? (current === last ? 0 : current + 1)
      : e.key === 'ArrowLeft' ? (current === 0 ? last : current - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    pick(next);
  };

  // Keep the row reachable by Tab even if `value` matches no option.
  const focusable = Math.max(0, options.findIndex((o) => o.value === value));

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="tab"
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={i === focusable ? 0 : -1}
            onClick={() => pick(i)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
