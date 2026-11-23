import './FixedDigits.css';

/**
 * Text whose digits each sit in a fixed-width cell, so a running clock never
 * jitters. Wix Madefor has no tabular figures (`tnum`), so `tabular-nums`
 * alone does nothing. Separators stay unboxed.
 *
 * The cells are laid out for show only, so `text` must be read elsewhere. Pass
 * the whole text as `label` when nothing around the digits says it: the caller
 * names its element (an `aria-label`) and assistive tech reads the text once,
 * whole. Without `label` this renders only what sight sees, and find and text
 * selection see one copy, not a hidden second.
 */
export function FixedDigits({ text, label }: { text: string; label?: string }) {
  return (
    <span className="fixed-digits" role={label ? 'img' : undefined} aria-label={label}>
      <span aria-hidden="true">
        {[...text].map((char, i) =>
          /\d/.test(char) ? (
            <span key={i} className="fixed-digits__d">
              {char}
            </span>
          ) : (
            char
          ),
        )}
      </span>
    </span>
  );
}
