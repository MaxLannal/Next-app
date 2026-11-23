import { useId } from 'react';

type SwitchProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** One calm line under the label: what the switch does, or why it's off. */
  hint?: string;
  busy?: boolean;
};

/**
 * A Dusk switch: a smoke track that turns periwinkle when on (done, on or
 * running). A plain checkbox underneath, so keyboard and screen readers get
 * the native behaviour.
 */
export function Switch({ label, checked, onChange, disabled, hint, busy }: SwitchProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="switch-row">
      <div className="switch-row__main">
        <label className="switch-row__label" htmlFor={id}>
          {label}
        </label>
        {hint !== undefined && (
          <p className="switch-row__hint" id={hintId}>
            {hint}
          </p>
        )}
      </div>
      <input
        id={id}
        className="switch"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled === true || busy === true}
        aria-describedby={hint !== undefined ? hintId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}
