// The skill tracker, mounted at `/api/skills`: skills, the nodes on a skill's canvas, and the links
// from a step to the experiences behind it.

import { Hono, type Context } from 'hono';
import type { AppContext } from '../context.ts';
import {
  createNode,
  createSkill,
  deleteNode,
  deleteSkill,
  getBoard,
  linkNodes,
  listSkills,
  nameStage,
  renameSkill,
  SkillInputError,
  unlink,
  updateNode,
} from '../repo/skills.ts';

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Input errors become a calm 400; anything else is a real failure. */
function guarded<T>(c: Context, work: () => T, status: 200 | 201 = 200) {
  try {
    return c.json(work() as object, status);
  } catch (err) {
    if (err instanceof SkillInputError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

export function skillRoutes(ctx: AppContext): Hono {
  const routes = new Hono();
  const id = (c: Context) => Number(c.req.param('id'));

  routes.get('/', (c) => c.json(listSkills(ctx.db)));
  routes.post('/', async (c) => {
    const body = await jsonBody(c);
    return guarded(c, () => createSkill(ctx.db, body.name, ctx.now()), 201);
  });

  // Nodes and links first, so their paths never read as a skill id.
  routes.patch('/nodes/:id{[0-9]+}', async (c) => {
    const body = await jsonBody(c);
    try {
      const node = updateNode(ctx.db, id(c), body, ctx.now());
      return node ? c.json(node) : c.json({ error: 'No such node' }, 404);
    } catch (err) {
      if (err instanceof SkillInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  routes.delete('/nodes/:id{[0-9]+}', (c) => (deleteNode(ctx.db, id(c), ctx.now()) ? c.body(null, 204) : c.json({ error: 'No such node' }, 404)));
  routes.post('/links', async (c) => {
    const body = await jsonBody(c);
    return guarded(c, () => linkNodes(ctx.db, body.stepId, body.experienceId, ctx.now()), 201);
  });
  routes.delete('/links/:id{[0-9]+}', (c) => (unlink(ctx.db, id(c)) ? c.body(null, 204) : c.json({ error: 'No such link' }, 404)));

  routes.get('/:id{[0-9]+}', (c) => {
    const board = getBoard(ctx.db, id(c));
    return board ? c.json(board) : c.json({ error: 'No such skill' }, 404);
  });
  routes.patch('/:id{[0-9]+}', async (c) => {
    const body = await jsonBody(c);
    try {
      const skill = renameSkill(ctx.db, id(c), body.name, ctx.now());
      return skill ? c.json(skill) : c.json({ error: 'No such skill' }, 404);
    } catch (err) {
      if (err instanceof SkillInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  routes.delete('/:id{[0-9]+}', (c) => (deleteSkill(ctx.db, id(c)) ? c.body(null, 204) : c.json({ error: 'No such skill' }, 404)));
  routes.put('/:id{[0-9]+}/stages/:layer{[0-9]+}', async (c) => {
    const body = await jsonBody(c);
    try {
      const skill = nameStage(ctx.db, id(c), Number(c.req.param('layer')), body.name, ctx.now());
      return skill ? c.json(skill) : c.json({ error: 'No such skill' }, 404);
    } catch (err) {
      if (err instanceof SkillInputError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  routes.post('/:id{[0-9]+}/nodes', async (c) => {
    const body = await jsonBody(c);
    return guarded(c, () => createNode(ctx.db, id(c), body, ctx.now()), 201);
  });

  return routes;
}
