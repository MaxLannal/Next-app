import type { Attachment } from '@shared/types.ts';
import { CodePreview } from './CodePreview.tsx';
import { Markdown } from './Markdown.tsx';
import { useFileText } from './useFileText.ts';

type NotebookCell = {
  cell_type?: unknown;
  source?: unknown;
  outputs?: unknown;
};

type NotebookOutput = {
  output_type?: unknown;
  text?: unknown;
  data?: Record<string, unknown>;
};

/** Turns a cell `source` (a list of lines or one string) into its text. */
function textOf(source: unknown): string {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) return source.map((line) => (typeof line === 'string' ? line : '')).join('');
  return '';
}

/** Output data as text: a list of lines, or one value that already is text. */
function dataText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) return value.join('');
  return null;
}

/**
 * A Jupyter notebook as its cells: markdown typeset, code highlighted with Shiki,
 * and the outputs that matter as text or images. Rich HTML outputs show their text.
 */
export function NotebookPreview({ file }: { file: Attachment }) {
  const read = useFileText(file.url, true);
  if (read === null) return <p className="pv-note">Reading the notebook…</p>;
  if ('error' in read) return <p className="pv-note">{read.error}</p>;

  let parsed: { cells?: unknown };
  try {
    // The file is served as `application/x-ipynb+json`, not `json`: the bytes arrive as text.
    parsed = JSON.parse(read.text) as { cells?: unknown };
  } catch {
    return <p className="pv-note">This file isn’t a notebook the hub can read.</p>;
  }
  const cells = Array.isArray(parsed.cells) ? (parsed.cells as NotebookCell[]) : [];

  return (
    <div className="nb">
      {cells.map((cell, i) => {
        if (cell.cell_type === 'markdown') {
          return (
            <div className="nb__cell nb__cell--md" key={i}>
              <Markdown>{textOf(cell.source)}</Markdown>
            </div>
          );
        }
        if (cell.cell_type !== 'code') return null;
        const outputs = Array.isArray(cell.outputs) ? (cell.outputs as NotebookOutput[]) : [];
        return (
          <div className="nb__cell" key={i}>
            <CodePreview code={textOf(cell.source)} lang="python" />
            {outputs.map((out, j) => {
              const data = out.data ?? {};
              const image = ['image/png', 'image/jpeg'].find((bundle) => data[bundle] !== undefined);
              if (image !== undefined) {
                const encoded = dataText(data[image]);
                if (encoded === null) return null;
                return (
                  <img
                    className="nb__out-image"
                    key={j}
                    src={`data:${image};base64,${encoded.replaceAll('\n', '')}`}
                    alt="Notebook output"
                  />
                );
              }
              const stream = dataText(out.text) ?? dataText(data['text/plain']);
              return stream === null || stream === '' ? null : (
                <pre className="nb__out" key={j}>
                  {stream}
                </pre>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
