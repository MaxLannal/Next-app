import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { EssayColumn, EssaySummary } from '@shared/types.ts';
import { formatShortDate } from '../../lib/format.ts';
import { ESSAY_COLUMNS, ESSAY_COLUMN_LABELS } from './columns.ts';

export const DRAG_TYPE = 'application/x-hub-essay';

type EssayCardProps = {
  essay: EssaySummary;
  /** The column it is in now; the "Move to…" menu leaves that one out. */
  column: EssayColumn;
  onMove: (to: EssayColumn) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  dragging: boolean;
};

/**
 * One essay in a column: title (or "Untitled"), date, first line and word
 * count. Draggable with a mouse, and "Move to…" opens a menu of the other columns.
 */
export function EssayCard({ essay, column, onMove, onDragStart, onDragEnd, dragging }: EssayCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const targets = ESSAY_COLUMNS.filter((c) => c !== column);

  useEffect(() => {
    if (!menuOpen) return;
    firstItem.current?.focus();
    const close = (e: MouseEvent) => {
      if (!menuWrap.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const menuKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      toggle.current?.focus();
    }
  };

  return (
    <li
      className={dragging ? 'essay is-dragging' : 'essay'}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-essay-id={essay.id}
    >
      <div className="essay__top">
        <Link className="essay__title" to={`/essays/${essay.id}`}>
          {essay.title.trim() === '' ? 'Untitled' : essay.title}
        </Link>
        <div className="essay__menu-wrap" ref={menuWrap}>
          <button
            ref={toggle}
            type="button"
            className="essay__more"
            aria-label={`More for ${essay.title.trim() === '' ? 'Untitled' : essay.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="3" cy="8" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="13" cy="8" r="1.4" />
            </svg>
          </button>
          {menuOpen && (
            <div className="essay__menu" role="menu" aria-label="Move to…" onKeyDown={menuKeys}>
              {targets.map((to, i) => (
                <button
                  key={to}
                  ref={i === 0 ? firstItem : undefined}
                  type="button"
                  role="menuitem"
                  className="essay__menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(to);
                  }}
                >
                  {ESSAY_COLUMN_LABELS[to]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="essay__meta num">
        <time dateTime={essay.updatedAt}>{formatShortDate(essay.updatedAt)}</time>
        <span aria-hidden="true"> · </span>
        <span>
          {essay.wordCount} {essay.wordCount === 1 ? 'word' : 'words'}
        </span>
      </p>
      {essay.firstLine.trim() !== '' && <p className="essay__line">{essay.firstLine}</p>}
    </li>
  );
}
