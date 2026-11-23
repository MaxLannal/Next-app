import { useEffect, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import type { Turn } from './useChat.ts';

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [rehypeKatex];

/** Links open beside the hub, never in place of it; anything but http(s) stays text. */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href !== undefined && /^https?:\/\//i.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/** What Claude is doing while a tool runs, in the hub's words. */
const TOOL_LINES: Record<string, string> = {
  search: 'Searching your hub…',
  list_sessions: 'Looking at your sessions…',
  get_session: 'Looking at your sessions…',
  get_essay: 'Reading your essay…',
  goal_progress: 'Looking at your goals…',
  stats: 'Adding up your focus time…',
  sleep: 'Looking at your sleep…',
  exercise: 'Looking at your exercise…',
  resources: 'Looking at your resources…',
};

export const toolLine = (name: string) => TOOL_LINES[name] ?? 'Looking through your hub…';

type MessageViewProps = {
  turns: Turn[];
  streaming: boolean;
  tool: string | null;
  error: string | null;
  /** Stop was pressed before any of the answer arrived. */
  stopped?: boolean;
  onRetry: () => void;
  /** Shown before the first message. */
  empty: ReactNode;
};

/**
 * The conversation: the user's questions on paper-3, Claude's answers unboxed in Markdown (tables,
 * math, code), the tool line while one runs, and an error with Retry in place of an answer.
 */
export function MessageView({ turns, streaming, tool, error, stopped = false, onRetry, empty }: MessageViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = turns.at(-1);
  const canRegenerate = !streaming && error === null && last?.role === 'assistant';
  const showStopped = stopped && error === null && !streaming && last?.role === 'user';
  const waiting = streaming && tool === null && last?.role === 'user';

  // Follows the answer as it streams, unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, tool, error, streaming, stopped]);

  return (
    <div
      ref={scrollRef}
      className="chat__log"
      role="log"
      aria-live="polite"
      aria-busy={streaming}
      aria-label="Conversation"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {turns.length === 0 && !streaming ? (
        empty
      ) : (
        <ol className="chat__turns">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <li key={turn.key} className="chat-msg chat-msg--user">
                <p>{turn.content}</p>
              </li>
            ) : (
              <li key={turn.key} className="chat-msg chat-msg--assistant">
                <div className="chat-md">
                  <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
                    {turn.content}
                  </ReactMarkdown>
                </div>
              </li>
            ),
          )}
        </ol>
      )}

      {(tool !== null || waiting) && (
        <p className="chat__tool" role="status">
          <span className="chat__dot" aria-hidden="true" />
          {tool === null ? 'Thinking…' : toolLine(tool)}
        </p>
      )}

      {error !== null && (
        <div className="chat__error">
          <p role="alert">{error}</p>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry} disabled={streaming}>
            Retry
          </button>
        </div>
      )}

      {showStopped && (
        <div className="chat__error chat__error--quiet">
          <p>Stopped before Claude answered</p>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {canRegenerate && (
        <div className="chat__after">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
