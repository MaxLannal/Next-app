import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatEvent, ChatStatus } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import {
  conversationExists,
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  rewindToLastUser,
  runChat,
} from '../services/chat.ts';

const ID = '/conversations/:id{[0-9]{1,15}}';
const MAX_MESSAGE = 20_000;
const MAX_PAGE = 300;

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Mounted at `/api/chat`: the sidebar's conversations, and one answer as server-sent events. */
export function chatRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const found = (c: Context) => {
    const id = Number(c.req.param('id'));
    return conversationExists(ctx, id) ? id : null;
  };

  routes.get('/status', (c) => {
    const { baseURL, authToken, model } = ctx.config.get().anthropic;
    return c.json({ configured: Boolean(baseURL && authToken), model } satisfies ChatStatus);
  });

  routes.get('/conversations', (c) => c.json(listConversations(ctx)));
  routes.post('/conversations', (c) => c.json({ id: createConversation(ctx) }, 201));

  routes.get(ID, (c) => {
    const id = found(c);
    return id === null ? c.json({ error: 'Not found' }, 404) : c.json(getMessages(ctx, id));
  });

  routes.delete(ID, (c) => {
    const id = Number(c.req.param('id'));
    return deleteConversation(ctx, id) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  });

  // `{content, page?, retry?}`. `page` is the path the user asked from; `retry` asks the last question
  // again in place of its answer. Each `ChatEvent` is one SSE event named by its type.
  routes.post(`${ID}/messages`, async (c) => {
    const id = found(c);
    if (id === null) return c.json({ error: 'Not found' }, 404);
    const body = await jsonBody(c);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (content === '') return c.json({ error: 'Write a question first' }, 400);
    if (content.length > MAX_MESSAGE) return c.json({ error: `A question can be ${MAX_MESSAGE} characters at most` }, 400);
    const page = typeof body.page === 'string' && body.page.length <= MAX_PAGE ? body.page : undefined;
    if (body.retry === true) rewindToLastUser(ctx, id);

    return streamSSE(c, async (stream) => {
      // the user closing the tab, or pressing Stop, ends the request: the answer stops with it.
      const controller = new AbortController();
      const abort = () => controller.abort();
      stream.onAbort(abort);
      c.req.raw.signal.addEventListener('abort', abort, { once: true });

      let sent = Promise.resolve();
      const emit = (e: ChatEvent) => {
        if (controller.signal.aborted) return;
        sent = sent.then(() => stream.writeSSE({ event: e.type, data: JSON.stringify(e) })).catch(abort);
      };
      try {
        await runChat(ctx, id, content, emit, controller.signal, page);
        await sent;
      } finally {
        c.req.raw.signal.removeEventListener('abort', abort);
      }
    });
  });

  return routes;
}
