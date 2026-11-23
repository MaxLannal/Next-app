import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const INITIAL_WIDTH = 400;
const RAIL_WIDTH = 48;
/** The panel floats this far from the window's edges (`--chat-gap`). */
const GAP = 12;
/** What the page keeps for itself before the panel may grow into it. */
const PAGE_MIN = 480;
/**
 * The panel (open, or its rail) takes room from the page only while this much window is left
 * beside it. The pages lay themselves out by window width, so a narrower page would overflow:
 * below this the panel floats over the page instead.
 */
const PAGE_FOR_PADDING = 1040;
/** A first visit opens the panel on a window at least this wide, and starts as the rail below it. */
const OPEN_BY_DEFAULT = 1440;

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

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PLUS = 'M9 4v10M4 9h10';
const CLOSE_RIGHT = 'M7 5l4 4-4 4';
const OPEN_LEFT = 'M11 5 7 9l4 4';
const BUBBLE = 'M3.5 4.5h11v7h-6l-3 2.5v-2.5h-2z';
const CROSS = 'M5 5l8 8M13 5l-8 8';

/**
 * Claude beside every page, reading the user's hub. On a wide window it is a glass panel on the
 * right, resizable from its left edge and collapsible to a rail. The page keeps clear of the
 * rail, and of the open panel while at least 1040 px of window is left beside it; on a
 * narrower window the open panel floats over the page. Under 900 px it opens as a sheet from
 * the Ask pill. Mounted once, in the app shell, so a conversation carries on from page to page.
 */
export function ChatSidebar() {
  const desktop = useMedia(DESKTOP);
  const windowWidth = useWindowWidth();
  const panel = useResizable({
    min: MIN_WIDTH,
    max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, windowWidth - PAGE_MIN)),
    initial: INITIAL_WIDTH,
    storageKey: 'hub:chat-width',
    openKey: 'hub:chat-open',
    defaultCollapsed: window.innerWidth < OPEN_BY_DEFAULT,
  });
  const floating = windowWidth - (panel.collapsed ? RAIL_WIDTH : panel.width) < PAGE_FOR_PADDING;
  const [sheetOpen, setSheetOpen] = useState(false);
  const { pathname } = useLocation();
  const chat = useChat();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);

  const status = useQuery({
    queryKey: ['chat', 'status'],
    queryFn: ({ signal }) => api<ChatStatus>('/api/chat/status', { signal }),
    staleTime: 5 * 60_000,
  });
  const conversations = useQuery({
    queryKey: CONVERSATIONS_KEY,
    queryFn: ({ signal }) => api<ChatConversation[]>('/api/chat/conversations', { signal }),
  });

  // The page and the nav keep clear of the rail, and of the open panel unless it floats (see
  // chat.css); nothing to keep under 900 px. Re-read as the window resizes.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!desktop || floating) {
      root.style.removeProperty('--chat-space');
      return;
    }
    root.style.setProperty('--chat-space', `${(panel.collapsed ? RAIL_WIDTH : panel.width) + 2 * GAP}px`);
    return () => {
      root.style.removeProperty('--chat-space');
    };
  }, [desktop, floating, panel.collapsed, panel.width]);

  const notSetUp = status.data?.configured === false;
  const current = conversations.data?.find((c) => c.id === chat.conversationId);
  const title = current && current.title !== '' ? current.title : 'New chat';
  const ask = (text: string) => void chat.send(text, pathname);
  const newChat = () => {
    void chat.open(null);
    fieldRef.current?.focus();
  };
  const closeSheet = () => {
    setSheetOpen(false);
    requestAnimationFrame(() => askRef.current?.focus());
  };

  const empty: ReactNode = notSetUp ? (
    <div className="chat__empty">
      <p className="chat__empty-title">Claude isn’t set up yet</p>
      <p className="chat__empty-line">
        The hub has no gateway to ask. Run setup with ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN set, then restart the hub.
      </p>
      <Link className="btn btn-ghost btn-sm" to="/settings" onClick={sheetOpen ? closeSheet : undefined}>
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

  const head = (end: ReactNode) => (
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
      {end}
    </header>
  );

  const conversation = (
    <>
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

  if (desktop) {
    if (panel.collapsed) {
      return (
        <aside className={floating ? 'glass chat chat--rail chat--over' : 'glass chat chat--rail'} aria-label="Chat">
          <button className="chat__icon" type="button" aria-label="Open chat" aria-expanded="false" title="Open chat" onClick={panel.toggle}>
            <Icon d={OPEN_LEFT} />
          </button>
          <button
            className="chat__icon"
            type="button"
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              void chat.open(null);
              panel.toggle();
            }}
          >
            <Icon d={PLUS} />
          </button>
        </aside>
      );
    }
    return (
      <aside
        className={floating ? 'glass chat chat--panel chat--over' : 'glass chat chat--panel'}
        aria-label="Chat"
        style={{ '--chat-w': `${panel.width}px` } as CSSProperties}
      >
        <div className="chat__edge" aria-label="Chat width" {...panel.handleProps} />
        {head(
          <button className="chat__icon" type="button" aria-label="Collapse chat" aria-expanded="true" title="Collapse chat" onClick={panel.toggle}>
            <Icon d={CLOSE_RIGHT} />
          </button>,
        )}
        {conversation}
      </aside>
    );
  }

  return (
    <>
      {!sheetOpen && (
        <button ref={askRef} className="chat-ask" type="button" onClick={() => setSheetOpen(true)}>
          <Icon d={BUBBLE} />
          Ask
        </button>
      )}
      {sheetOpen && (
        <ChatSheet fieldRef={fieldRef} onClose={closeSheet}>
          {head(
            <button className="chat__icon" type="button" aria-label="Close chat" title="Close chat" onClick={closeSheet}>
              <Icon d={CROSS} />
            </button>,
          )}
          {conversation}
        </ChatSheet>
      )}
    </>
  );
}

type ChatSheetProps = {
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The narrow-screen chat: a modal glass sheet over the dimmed page. Focus starts in the field
 * (on the sheet's heading when the field is off, as before setup) and stays inside.
 */
function ChatSheet({ fieldRef, onClose, children }: ChatSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const field = fieldRef.current;
    if (field && !field.disabled) field.focus();
    else headingRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [fieldRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
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
      <div ref={dialogRef} className="glass chat chat--sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 ref={headingRef} id={titleId} className="visually-hidden" tabIndex={-1}>
          Chat
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
