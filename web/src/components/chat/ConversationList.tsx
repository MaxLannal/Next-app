import { useEffect, useId, useRef, useState } from 'react';
import type { ChatConversation } from '@shared/types.ts';
import { formatShortDate } from '../../lib/format.ts';

type ConversationListProps = {
  conversations: ChatConversation[];
  currentId: number | null;
  /** The open conversation's title; "New chat" before its first question. */
  title: string;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
};

/**
 * The header's title with a ▾ that opens the earlier conversations, newest first. Each opens on
 * click and can be deleted. Esc or a click outside closes the list.
 */
export function ConversationList({ conversations, currentId, title, onOpen, onDelete }: ConversationListProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="chat-convs"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        className="chat-convs__trigger"
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${title} — earlier chats`}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="chat-convs__title">{title}</span>
        <svg className="chat-convs__caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="chat-convs__pop" id={listId}>
          {conversations.length === 0 ? (
            <p className="chat-convs__none">No earlier chats</p>
          ) : (
            <ul className="chat-convs__list" aria-label="Earlier chats">
              {conversations.map((c) => (
                <li key={c.id} className={c.id === currentId ? 'chat-convs__row is-current' : 'chat-convs__row'}>
                  <button
                    className="chat-convs__open"
                    type="button"
                    aria-current={c.id === currentId ? 'true' : undefined}
                    onClick={() => {
                      onOpen(c.id);
                      close();
                    }}
                  >
                    <span className="chat-convs__name">{c.title === '' ? 'New chat' : c.title}</span>
                    <span className="chat-convs__when num">{formatShortDate(c.updatedAt)}</span>
                  </button>
                  <button
                    className="chat-convs__delete"
                    type="button"
                    aria-label={`Delete “${c.title === '' ? 'New chat' : c.title}”`}
                    onClick={() => onDelete(c.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
