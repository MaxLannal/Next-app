import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatMessage } from '@shared/types.ts';
import { api, ApiError, LOGIN_REQUIRED_EVENT } from '../../api.ts';

/** One turn on screen. `id` is the stored message's, once the hub has saved it. */
export type Turn = { key: string; role: 'user' | 'assistant'; content: string; id: number | null };

export const CONVERSATIONS_KEY = ['chat', 'conversations'] as const;
const CURRENT_KEY = 'hub:chat-conversation';

let keys = 0;
const nextKey = () => `turn-${++keys}`;
const toTurn = (m: ChatMessage): Turn => ({ key: `msg-${m.id}`, role: m.role, content: m.content, id: m.id });
const messageOf = (err: unknown) => (err instanceof Error && err.message !== '' ? err.message : 'something went wrong');

function storedId(): number | null {
  try {
    const n = Number(localStorage.getItem(CURRENT_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storeId(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(CURRENT_KEY);
    else localStorage.setItem(CURRENT_KEY, String(id));
  } catch {
    // Not remembered across reloads; the chat still works.
  }
}

/**
 * Reads server-sent events as they arrive: feed it text chunks, and it calls `onEvent` with each
 * complete event's JSON `data`. A chunk may end mid-event; the rest waits for the next one.
 */
export function sseParser(onEvent: (e: ChatEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data === '') continue;
      try {
        onEvent(JSON.parse(data) as ChatEvent);
      } catch {
        // Not an event the hub sends: skip it.
      }
    }
  };
}

const UNREACHABLE = 'Couldn’t reach the hub';
const STOPPED_EARLY = 'The answer stopped early — retry';

/**
 * Posts one question and reads the answer's events until the stream ends or `signal` aborts.
 * A hub that can't be reached throws `ApiError` 0; a connection lost partway just ends the
 * stream, and the caller sees that no `done` or `error` arrived.
 */
async function streamAnswer(
  conversationId: number,
  body: { content: string; page: string; replaceFrom?: number },
  signal: AbortSignal,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError(0, UNREACHABLE, null);
  }
  if (!res.ok || !res.body) {
    if (res.status === 401) window.dispatchEvent(new Event(LOGIN_REQUIRED_EVENT));
    const reply = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiError(res.status, typeof reply?.error === 'string' ? reply.error : `The hub answered ${res.status}`, reply);
  }
  const feed = sseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(value);
    }
  } catch (err) {
    if (signal.aborted) throw err;
  }
}

/** Everything before the last question: what a retry keeps. */
function beforeLastQuestion(turns: Turn[]): Turn[] {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return turns.slice(0, i);
  return turns;
}

/**
 * The sidebar's conversation: its turns, the answer streaming in, the tool Claude is running,
 * and an error to show inline. The open conversation is remembered across reloads.
 */
export function useChat() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<number | null>(storedId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Stop was pressed before any of the answer arrived: the question waits for a Retry. */
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadRef = useRef(0);

  const open = useCallback(async (id: number | null) => {
    abortRef.current?.abort();
    const load = ++loadRef.current;
    setConversationId(id);
    storeId(id);
    setError(null);
    setStopped(false);
    setTool(null);
    setTurns([]);
    if (id === null) return;
    try {
      const messages = await api<ChatMessage[]>(`/api/chat/conversations/${id}`);
      if (load === loadRef.current) setTurns(messages.map(toTurn));
    } catch (err) {
      if (load !== loadRef.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setConversationId(null);
        storeId(null);
      } else setError(`Couldn’t open this chat: ${messageOf(err)}`);
    }
  }, []);

  // The conversation left open last time.
  useEffect(() => {
    const id = storedId();
    if (id !== null) void open(id);
    return () => abortRef.current?.abort();
  }, [open]);

  /**
   * Asks `content`. `retryOf` is the question being asked again: it and what follows leave the
   * screen, and the hub replaces them only when it had stored that question (its `saved` id);
   * a question the hub never got is simply asked.
   */
  const send = useCallback(
    async (content: string, page: string, retryOf?: Turn) => {
      const text = content.trim();
      if (text === '' || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStopped(false);
      setStreaming(true);
      const questionKey = nextKey();
      setTurns((prev) => [...(retryOf ? beforeLastQuestion(prev) : prev), { key: questionKey, role: 'user', content: text, id: null }]);

      const answerKey = nextKey();
      let answer = '';
      let ended = false;
      const onEvent = (e: ChatEvent) => {
        if (e.type === 'saved') setTurns((prev) => prev.map((t) => (t.key === questionKey ? { ...t, id: e.messageId } : t)));
        else if (e.type === 'tool') setTool(e.name);
        else if (e.type === 'error') {
          ended = true;
          setError(e.message);
        } else if (e.type === 'text') {
          answer += e.delta;
          const shown = answer;
          setTool(null);
          setTurns((prev) => {
            const at = prev.findIndex((t) => t.key === answerKey);
            const turn: Turn = { key: answerKey, role: 'assistant', content: shown, id: null };
            return at === -1 ? [...prev, turn] : prev.map((t, i) => (i === at ? turn : t));
          });
        } else {
          ended = true;
          setTurns((prev) => prev.map((t) => (t.key === answerKey ? { ...t, id: e.messageId } : t)));
        }
      };
      const newConversation = async () => {
        const { id } = await api<{ id: number }>('/api/chat/conversations', { method: 'POST', signal: controller.signal });
        loadRef.current++;
        setConversationId(id);
        storeId(id);
        return id;
      };

      try {
        const id = conversationId ?? (await newConversation());
        const replaceFrom = retryOf?.id ?? undefined;
        try {
          await streamAnswer(id, { content: text, page, replaceFrom }, controller.signal, onEvent);
        } catch (err) {
          // The chat was deleted elsewhere: ask in a new one, once.
          if (!(err instanceof ApiError && err.status === 404)) throw err;
          await streamAnswer(await newConversation(), { content: text, page }, controller.signal, onEvent);
        }
        if (!ended && !controller.signal.aborted) setError(STOPPED_EARLY);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 0 ? UNREACHABLE : messageOf(err));
      } finally {
        if (controller.signal.aborted && answer === '') setStopped(true);
        abortRef.current = null;
        setStreaming(false);
        setTool(null);
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      }
    },
    [conversationId, queryClient],
  );

  /** Stops the answer where it is; what streamed stays, and the hub keeps it too. */
  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Asks the last question again, in place of its answer (or its error). */
  const retry = useCallback(
    (page: string) => {
      const last = [...turns].reverse().find((t) => t.role === 'user');
      if (last) void send(last.content, page, last);
    },
    [turns, send],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          setError(`Couldn’t delete that chat: ${messageOf(err)}`);
          return;
        }
      }
      if (id === conversationId) void open(null);
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    },
    [conversationId, open, queryClient],
  );

  return { conversationId, turns, streaming, tool, error, stopped, open, send, stop, retry, remove };
}
