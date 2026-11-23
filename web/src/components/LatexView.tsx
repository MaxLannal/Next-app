import katex from 'katex';
import { useMemo, useState } from 'react';
import 'katex/dist/katex.min.css';
import './LatexView.css';

type LatexViewProps = {
  /** LaTeX body content: the same text saved in the `.tex` file. */
  latex: string;
  onEdit?: (latex: string) => void;
  onRetry?: () => void;
};

/**
 * A LaTeX reading, rendered with KaTeX. "Source" swaps the typeset view for
 * the plain text; Edit hands the text to `onEdit`; Retry asks for a new reading
 * of the photo (shown once a reading has been made and only when offered).
 */
export function LatexView({ latex, onEdit, onRetry }: LatexViewProps) {
  const [source, setSource] = useState(false);
  const rendered = useMemo(
    () => ({ __html: katex.renderToString(latex, { displayMode: true, throwOnError: false }) }),
    [latex],
  );

  return (
    <figure className="latex">
      <div className="latex__head">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={source}
          onClick={() => setSource((on) => !on)}
        >
          Source
        </button>
        <div className="latex__pills">
          {onEdit !== undefined && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(latex)}>
              Edit
            </button>
          )}
          {onRetry !== undefined && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
      {source ? (
        <pre className="latex__source">
          <code>{latex}</code>
        </pre>
      ) : (
        <div className="latex__body" dangerouslySetInnerHTML={rendered} />
      )}
    </figure>
  );
}
