import { Hono, type Context } from 'hono';
import type { FocusSession, SessionEvent, SessionFilters } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { assertTimeZone } from '../lib/time.ts';
import {
  appendEvent,
  getEvents,
  getSession,
  listSessions,
  listSubjects,
  listTags,
  openSession,
  recomputeFocus,
  setTags,
  transaction,
  upsertSubject,
} from '../repo/sessions.ts';

const ID = '/:id{[0-9]+}';
const TRANSITIONS: Record<'pause' | 'resume' | 'stop', FocusSession['status']> = {
  pause: 'running',
  resume: 'paused',
  stop: 'running',
};

const isId = (raw: string): number | null => (/^[1-9][0-9]*$/.test(raw) ? Number(raw) : null);
const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function iso(value: string): string {
  return new Date(value).toISOString();
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => ({}));
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

type Fields = { name?: string; subjectName?: string | null; tags?: string[]; goalId?: number | null; notes?: string };

/** Reads and checks the editable session fields; returns an error message or the clean fields. */
function readFields(body: Record<string, unknown>): { error: string } | { fields: Fields } {
  const fields: Fields = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') return { error: 'A session needs a name' };
    fields.name = body.name.trim();
  }
  if (body.subjectName !== undefined) {
    if (body.subjectName === null || body.subjectName === '') fields.subjectName = null;
    else if (typeof body.subjectName === 'string' && body.subjectName.trim() !== '') fields.subjectName = body.subjectName;
    else return { error: 'Subject must be text' };
  }
  if (body.tags !== undefined) {
    const tags = Array.isArray(body.tags) ? body.tags : null;
    if (!tags || tags.some((tag) => typeof tag !== 'string')) return { error: 'Tags must be a list of names' };
    fields.tags = tags.filter((tag: string) => tag.trim() !== '');
  }
  if (body.goalId !== undefined) {
    if (body.goalId !== null && (typeof body.goalId !== 'number' || !Number.isInteger(body.goalId) || body.goalId <= 0)) {
      return { error: 'Goal must be a goal id' };
    }
    fields.goalId = body.goalId;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return { error: 'Notes must be text' };
    fields.notes = body.notes;
  }
  return { fields };
}

/** Writes the fields and re-indexes; call inside a transaction. */
function applyFields(ctx: AppContext, id: number, fields: Fields): void {
  const subjectId = fields.subjectName === undefined ? undefined : fields.subjectName === null ? null : upsertSubject(ctx.db, fields.subjectName).id;
  ctx.db
    .prepare(
      `UPDATE focus_sessions SET name = coalesce(?, name), subject_id = CASE WHEN ? THEN ? ELSE subject_id END,
         goal_id = CASE WHEN ? THEN ? ELSE goal_id END, notes = coalesce(?, notes) WHERE id = ?`,
    )
    .run(
      fields.name ?? null,
      subjectId === undefined ? 0 : 1,
      subjectId ?? null,
      fields.goalId === undefined ? 0 : 1,
      fields.goalId ?? null,
      fields.notes ?? null,
      id,
    );
  if (fields.tags !== undefined) setTags(ctx.db, id, fields.tags);
}

function createSession(
  ctx: AppContext,
  fields: { name: string; subjectName?: string | null; tags?: string[]; goalId?: number | null },
  status: FocusSession['status'],
  startedAt: Date,
  endedAt: Date | null,
): number {
  return transaction(ctx.db, () => {
    const subjectId = fields.subjectName ? upsertSubject(ctx.db, fields.subjectName).id : null;
    const { lastInsertRowid } = ctx.db
      .prepare(
        `INSERT INTO focus_sessions (name, subject_id, goal_id, status, started_at, ended_at, focus_seconds, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        fields.name,
        subjectId,
        fields.goalId ?? null,
        status,
        startedAt.toISOString(),
        endedAt?.toISOString() ?? null,
        ctx.now().toISOString(),
      );
    const id = Number(lastInsertRowid);
    appendEvent(ctx.db, id, 'start', startedAt);
    if (endedAt) appendEvent(ctx.db, id, 'stop', endedAt);
    if (fields.tags) setTags(ctx.db, id, fields.tags);
    recomputeFocus(ctx.db, id, ctx.now());
    return id;
  });
}

function parseFilters(q: Record<string, string>): { error: string } | { filters: SessionFilters } {
  const filters: SessionFilters = {};
  if (q.from !== undefined || q.to !== undefined) {
    if ((q.from !== undefined && !isDay(q.from)) || (q.to !== undefined && !isDay(q.to))) {
      return { error: 'Dates must be YYYY-MM-DD' };
    }
    if (q.from !== undefined) filters.from = q.from;
    if (q.to !== undefined) filters.to = q.to;
  }
  for (const key of ['subjectId', 'goalId', 'limit'] as const) {
    if (q[key] !== undefined) {
      const n = isId(q[key]);
      if (n === null) return { error: `Bad ${key}` };
      filters[key] = n;
    }
  }
  if (q.tag !== undefined) filters.tag = q.tag;
  if (q.sort !== undefined) {
    if (q.sort !== 'created' && q.sort !== 'subject' && q.sort !== 'duration') return { error: 'Bad sort' };
    filters.sort = q.sort;
  }
  return { filters };
}

/** Mounted at `/api`: subjects, tags and sessions. */
export function sessionRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const tz = () => {
    const zone = ctx.timeZone();
    assertTimeZone(zone);
    return zone;
  };
  const find = (id: number) => (id === 0 ? null : getSession(ctx.db, id, ctx.now()));

  routes.get('/subjects', (c) => c.json(listSubjects(ctx.db)));

  routes.post('/subjects', async (c) => {
    const { name } = await jsonBody(c);
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'A subject needs a name' }, 400);
    const before = ctx.db.prepare('SELECT 1 FROM subjects WHERE name = ?').get(name.trim()) !== undefined;
    const subject = upsertSubject(ctx.db, name);
    return c.json(subject, before ? 200 : 201);
  });

  routes.get('/tags', (c) => c.json(listTags(ctx.db)));

  routes.get('/sessions', (c) => {
    let parsed: ReturnType<typeof parseFilters>;
    try {
      parsed = parseFilters(c.req.query());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    return c.json(listSessions(ctx.db, parsed.filters, ctx.now(), tz()));
  });

  routes.get('/sessions/current', (c) => {
    const open = openSession(ctx.db);
    return c.json(open ? getSession(ctx.db, open.id, ctx.now()) : null);
  });

  routes.post('/sessions', async (c) => {
    const read = readFields(await jsonBody(c));
    if ('error' in read) return c.json({ error: read.error }, 400);
    const { fields } = read;
    if (fields.name === undefined) return c.json({ error: 'A session needs a name' }, 400);
    if (openSession(ctx.db)) return c.json({ error: 'A session is already running' }, 409);
    const id = createSession(ctx, { ...fields, name: fields.name }, 'running', ctx.now(), null);
    return c.json(getSession(ctx.db, id, ctx.now()), 201);
  });

  routes.post('/sessions/manual', async (c) => {
    const body = await jsonBody(c);
    const read = readFields(body);
    if ('error' in read) return c.json({ error: read.error }, 400);
    const { fields } = read;
    const { name, ...rest } = fields;
    if (name === undefined) return c.json({ error: 'A session needs a name' }, 400);
    if (!isIso(body.startedAt) || !isIso(body.endedAt)) return c.json({ error: 'Start and end must be times' }, 400);
    if (Date.parse(body.endedAt) <= Date.parse(body.startedAt)) return c.json({ error: 'End is before start' }, 400);
    const id = createSession(
      ctx,
      { ...rest, name, subjectName: rest.subjectName ?? null },
      'done',
      new Date(body.startedAt),
      new Date(body.endedAt),
    );
    return c.json(getSession(ctx.db, id, ctx.now()), 201);
  });

  for (const action of ['pause', 'resume', 'stop'] as const) {
    routes.post(`/sessions${ID}/${action}`, (c) => {
      const id = Number(c.req.param('id'));
      const session = find(id);
      if (!session) return c.json({ error: 'Not found' }, 404);
      if (session.status !== TRANSITIONS[action]) return c.json({ error: `Can't ${action} a ${session.status} session` }, 409);
      transaction(ctx.db, () => {
        const now = ctx.now();
        appendEvent(ctx.db, id, action, now);
        if (action === 'stop') {
          ctx.db
            .prepare("UPDATE focus_sessions SET status = 'done', ended_at = ?, auto_paused_at = NULL WHERE id = ?")
            .run(now.toISOString(), id);
        } else if (action === 'pause') {
          ctx.db.prepare("UPDATE focus_sessions SET status = 'paused' WHERE id = ?").run(id);
        } else {
          ctx.db.prepare("UPDATE focus_sessions SET status = 'running', auto_paused_at = NULL WHERE id = ?").run(id);
        }
        recomputeFocus(ctx.db, id, now);
          });
      return c.json(getSession(ctx.db, id, ctx.now()));
    });
  }

  routes.get(`/sessions${ID}`, (c) => {
    const session = find(Number(c.req.param('id')));
    return session ? c.json(session) : c.json({ error: 'Not found' }, 404);
  });

  routes.patch(`/sessions${ID}`, async (c) => {
    const id = Number(c.req.param('id'));
    if (!find(id)) return c.json({ error: 'Not found' }, 404);
    const body = await jsonBody(c);
    const read = readFields(body);
    if ('error' in read) return c.json({ error: read.error }, 400);
    const { fields } = read;
    if (body.startedAt !== undefined && !isIso(body.startedAt)) return c.json({ error: 'Start must be a time' }, 400);
    if (body.endedAt !== undefined && body.endedAt !== null && !isIso(body.endedAt)) {
      return c.json({ error: 'End must be a time' }, 400);
    }

    const current = ctx.db
      .prepare('SELECT started_at, ended_at FROM focus_sessions WHERE id = ?')
      .get(id) as { started_at: string; ended_at: string | null };
    const startedAt = body.startedAt === undefined ? current.started_at : iso(body.startedAt);
    const endedAt =
      body.endedAt === undefined ? current.ended_at : body.endedAt === null ? null : iso(body.endedAt);
    if (endedAt !== null && Date.parse(endedAt) <= Date.parse(startedAt)) {
      return c.json({ error: 'End is before start' }, 400);
    }

    transaction(ctx.db, () => {
      applyFields(ctx, id, fields);
      if (body.startedAt !== undefined || body.endedAt !== undefined) rewriteTimes(ctx.db, id, startedAt, endedAt);
      recomputeFocus(ctx.db, id, ctx.now());
      });
    return c.json(getSession(ctx.db, id, ctx.now()));
  });

  routes.delete(`/sessions${ID}`, (c) => {
    const id = Number(c.req.param('id'));
    const { changes } = ctx.db.prepare('DELETE FROM focus_sessions WHERE id = ?').run(id);
    return Number(changes) > 0 ? c.body(null, 204) : c.json({ error: 'Not found' }, 404);
  });

  return routes;
}

/**
 * Moves the first `start` to `startedAt` and (when it ends) the last `stop` to `endedAt`,
 * drops events outside the new bounds, and adds the start/stop the bounds imply.
 */
function rewriteTimes(db: AppContext['db'], id: number, startedAt: string, endedAt: string | null): void {
  const from = Date.parse(startedAt);
  const to = endedAt === null ? Infinity : Date.parse(endedAt);
  const events = getEvents(db, id).filter((e) => Date.parse(e.at) > from && Date.parse(e.at) < to);
  db.prepare('DELETE FROM session_events WHERE session_id = ?').run(id);
  const insert = (type: SessionEvent['type'], at: string) =>
    db.prepare('INSERT INTO session_events (session_id, type, at) VALUES (?, ?, ?)').run(id, type, at);
  insert('start', startedAt);
  for (const e of events) insert(e.type, e.at);
  if (endedAt !== null) insert('stop', endedAt);
  db.prepare('UPDATE focus_sessions SET started_at = ?, ended_at = ? WHERE id = ?').run(startedAt, endedAt, id);
}
