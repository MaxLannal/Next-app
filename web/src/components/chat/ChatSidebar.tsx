import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router';
import type { ChatConversation, ChatStatus } from '@shared/types.ts';
import { api } from '../../api.ts';
import { Composer } from './Composer.tsx';
import { ConversationList } from './ConversationList.tsx';
import { MessageView } from './MessageView.tsx';
import { CONVERSATIONS_KEY, useChat } from './useChat.ts';
import { useResizable } from './useResizable.ts';
import './chat.css';

const DESKTOP = '(min-width: 900px)';
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const INITIAL_WIDTH = 400;

const EXAMPLES = ['How far am I on my goals?', 'What did I work on this week?', 'How did I sleep this week?'];

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useMedia(query: string): boolean {
  const read = () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PLUS = 'M9 4v10M4 9h10';
const BUBBLE = 'M3.5 4.5h11v7h-6l-3 2.5v-2.5h-2z';
const CROSS = 'M5 5l8 8M13 5l-8 8';

/**
 * Claude over every page, reading the hub. Closed, it is one small "Chat" pill at the bottom
 * right; the page always keeps the whole window. Open, the chat floats over the page above the
 * pill, in Dusk's glass, resizable from its left edge; under 900 px it is a sheet. Open or closed
 * is remembered. Mounted once, in the app shell, so a conversation carries on from page to page.
 */
export function ChatSidebar() {
  const desktop = useMedia(DESKTOP);
  const panel = useResizable({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: INITIAL_WIDTH,
    storageKey: 'hub:chat-width',
    openKey: 'hub:chat-open',
    defaultCollapsed: true,
  });
  // A saved open state comes back on desktop only: on a small screen the sheet takes the whole
  // page (and the keyboard), so it opens only when the user taps the pill in this visit.
  const [tappedOpen, setTappedOpen] = useState(false);
  const open = !panel.collapsed && (desktop || tappedOpen);
  const { pathname } = useLocation();
  const chat = useChat();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const titleId = useId();
  // What focus should do after the next open or close: the user's own clicks move it, a reload doesn't.
  const focusNext = useRef<'field' | 'pill' | null>(null);

  const status = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: ({ signal }) => api<ChatStatus>('/api/chat/status', { signal }),
    staleTime: 5 * 60_000,
  });
  const conversations = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: ({ signal }) => api<ChatConversation[]>('/api/chat/conversations', { signal }),
  });

  const show = () => {
    focusNext.current = 'field';
    setTappedOpen(true);
    panel.setOpen(true);
  };
  const hide = () => {
    focusNext.current = 'pill';
    setTappedOpen(false);
    panel.setOpen(false);
  };

  // Into the field when the user opens the chat (the sheet does this itself), back to the pill when they close it.
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === 'pill') pillRef.current?.focus();
    else if (next === 'field' && desktop) {
      const field = fieldRef.current;
      if (field && !field.disabled) field.focus();
      else headingRef.current?.focus();
    }
  }, [open, desktop]);

  const notSetUp = status.data?.configured === false;
  const current = conversations.data?.find((c) => c.id === chat.conversationId);
  const title = current && current.title !== '' ? current.title : 'New chat';
  const ask = (text: string) => void chat.send(text, pathname);
  const newChat = () => {
    void chat.open(null);
    fieldRef.current?.focus();
  };

  const empty: ReactNode = notSetUp ? (
    <div className="chat__empty">
      <p className="chat__empty-title">Claude isn’t set up yet</p>
      <p className="chat__empty-line">
        The hub has no gateway to ask. Run setup with ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN set, then restart the hub.
      </p>
      <Link className="btn btn-ghost btn-sm" to="/settings" onClick={desktop ? undefined : hide}>
        Open Settings
      </Link>
    </div>
  ) : (
    <div className="chat__empty">
      <p className="chat__empty-title">Ask about your goals, sessions or essays</p>
      <p className="chat__empty-line">Claude reads your hub to answer, and knows which page you are on.</p>
      <div className="chat__examples">
        {EXAMPLES.map((q) => (
          <button key={q} className="btn btn-ghost btn-sm" type="button" onClick={() => ask(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );

  const body = (
    <>
      <h2 ref={headingRef} id={titleId} className="visually-hidden" tabIndex={-1}>
        Chat
      </h2>
      <header className="chat__head">
        <ConversationList
          conversations={conversations.data ?? []}
          currentId={chat.conversationId}
          title={title}
          onOpen={(id) => void chat.open(id)}
          onDelete={(id) => void chat.remove(id)}
        />
        <button className="chat__icon" type="button" aria-label="New chat" title="New chat" onClick={newChat}>
          <Icon d={PLUS} />
        </button>
        <button className="chat__icon" type="button" aria-label="Close chat" title="Close chat" onClick={hide}>
          <Icon d={CROSS} />
        </button>
      </header>
      <MessageView
        turns={chat.turns}
        streaming={chat.streaming}
        tool={chat.tool}
        error={chat.error}
        stopped={chat.stopped}
        onRetry={() => chat.retry(pathname)}
        empty={empty}
      />
      <Composer streaming={chat.streaming} disabled={notSetUp} fieldRef={fieldRef} onSend={ask} onStop={chat.stop} />
    </>
  );

  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    // Esc that only dismisses an input method's candidates (Chinese, Japanese…) must not close the chat.
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
    e.stopPropagation();
    hide();
  };

  return (
    <>
      {(desktop || !open) && (
        <button
          ref={pillRef}
          className="chat-pill"
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={open ? hide : show}
          onKeyDown={open ? onPanelKey : undefined}
        >
          <Icon d={BUBBLE} />
          Chat
        </button>
      )}
      {open && desktop && (
        <aside
          id={panelId}
          className="glass chat chat--overlay"
          aria-labelledby={titleId}
          style={{ '--chat-w': `${panel.width}px` } as CSSProperties}
          onKeyDown={onPanelKey}
        >
          <div className="chat__edge" aria-label="Chat width" {...panel.handleProps} />
          {body}
        </aside>
      )}
      {open && !desktop && (
        <ChatSheet id={panelId} titleId={titleId} fieldRef={fieldRef} headingRef={headingRef} onClose={hide}>
          {body}
        </ChatSheet>
      )}
    </>
  );
}

type ChatSheetProps = {
  id: string;
  titleId: string;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The narrow-screen chat: a modal glass sheet over the dimmed page. Focus starts in the field
 * (on the sheet's heading when the field is off, as before setup) and stays inside.
 */
function ChatSheet({ id, titleId, fieldRef, headingRef, onClose, children }: ChatSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const field = fieldRef.current;
    if (field && !field.disabled) field.focus();
    else headingRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [fieldRef, headingRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.stopPropagation();
      onClose();
      return;
    }
    const dialog = dialogRef.current;
    if (e.key !== 'Tab' || !dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="chat-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} id={id} className="glass chat chat--sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
