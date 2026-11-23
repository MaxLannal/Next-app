import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { currentQuery, countInDoc } from './ext/FindReplace.ts';

type FindReplaceBarProps = {
  editor: Editor;
  mode: 'find' | 'replace';
  onClose: () => void;
};

/** How many matches the plugin holds for the editor's current query. */
function countOf(editor: Editor): number {
  const search = currentQuery(editor.state);
  return search ? countInDoc(editor.state.doc, search.query, search.caseSensitive) : 0;
}

/**
 * Find and replace: the query finds every match as it is typed; Enter and the
 * arrows step through them; Replace changes the current one and Replace all the
 * whole document in one undoable step. Escape closes.
 */
export function FindReplaceBar({ editor, mode, onClose }: FindReplaceBarProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // The count follows the document too: a match replaced elsewhere drops out.
  // The plugin holds the query, so the new state has it.
  useEffect(() => {
    const search = () => setCount(countOf(editor));
    search();
    editor.on('transaction', search);
    return () => {
      editor.off('transaction', search);
    };
  }, [editor]);

  const search = (text: string, sensitive = caseSensitive) => {
    setQuery(text);
    if (text === '') editor.commands.setSearch({ query: '' });
    else editor.commands.setSearch({ query: text, caseSensitive: sensitive });
    setCount(countOf(editor));
  };

  const close = () => {
    editor.commands.setSearch({ query: '' });
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="fr" role="search" aria-label="Find and replace">
      <input
        ref={input}
        className="fr__input"
        type="search"
        aria-label="Find"
        placeholder="Find"
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            editor.commands.nextMatch();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="fr__count num" aria-live="polite">
        {query === '' ? '' : count === 0 ? 'None' : `${count}`}
      </span>
      <button type="button" className="tb-btn" aria-label="Previous match" title="Previous match" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.commands.previousMatch()}>
        <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      <button type="button" className="tb-btn" aria-label="Next match" title="Next match" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.commands.nextMatch()}>
        <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      <label className="fr__case">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => search(query, e.target.checked)} />
        Aa
      </label>
      {mode === 'replace' && (
        <>
          <input
            className="fr__input fr__input--replace"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor.commands.replaceCurrent(replacement);
                setCount(countOf(editor));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.commands.replaceCurrent(replacement);
              setCount(countOf(editor));
            }}
            disabled={count === 0}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.commands.replaceAll(replacement);
              setCount(countOf(editor));
            }}
            disabled={count === 0}
          >
            Replace all
          </button>
        </>
      )}
      <button type="button" className="tb-btn fr__close" aria-label="Close find" title="Close (Esc)" onClick={close}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
