import './FixedDigits.css';

/**
 * Text whose digits each sit in a fixed-width cell, so a running clock never
 * jitters. Wix Madefor has no tabular figures (`tnum`), so `tabular-nums`
 * alone does nothing. Separators stay unboxed. Screen readers get the text
 * once, whole, not digit by digit.
 */
export function FixedDigits({ text }: { text: string }) {
  return (
    <span className="fixed-digits">
      <span className="visually-hidden">{text}</span>
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
