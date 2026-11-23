// The skill tracker's storage: skills, the nodes on each skill's canvas, and the links between a
// step and the experiences that back it.

import type { DatabaseSync } from 'node:sqlite';
import type { Skill, SkillBoard, SkillFile, SkillLink, SkillNode, SkillNodeKind } from '../../shared/types.ts';

type SkillRow = { id: number; name: string; created_at: string; updated_at: string };
type NodeRow = {
  id: number;
  skill_id: number;
  kind: SkillNodeKind;
  title: string;
  description: string;
  layer: number;
  x: number;
  y: number;
  created_at: string;
  completed_on: string | null;
  session_id: number | null;
  s_name: string | null;
  s_subject: string | null;
  s_focus: number | null;
  s_started: string | null;
};

export class SkillInputError extends Error {}

/** Steps in each layer of a skill, foundations first; the canvas adds an empty layer on top. */
function layerSteps(db: DatabaseSync, skillId: number): number[] {
  const rows = db
    .prepare("SELECT layer, COUNT(*) AS n FROM skill_nodes WHERE skill_id = ? AND kind = 'step' GROUP BY layer")
    .all(skillId) as { layer: number; n: number }[];
  const top = (db.prepare('SELECT MAX(layer) AS top FROM skill_nodes WHERE skill_id = ?').get(skillId) as { top: number | null }).top ?? -1;
  const counts = Array.from({ length: top + 1 }, () => 0);
  for (const r of rows) counts[r.layer] = r.n;
  return counts;
}

function toSkill(db: DatabaseSync, row: SkillRow): Skill {
  const counts = db
    .prepare("SELECT SUM(kind = 'step') AS steps, SUM(kind = 'experience') AS experiences FROM skill_nodes WHERE skill_id = ?")
    .get(row.id) as { steps: number | null; experiences: number | null };
  const perLayer = layerSteps(db, row.id);
  const named = db.prepare('SELECT layer, name FROM skill_stages WHERE skill_id = ? ORDER BY layer').all(row.id) as { layer: number; name: string }[];
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: counts.steps ?? 0,
    experiences: counts.experiences ?? 0,
    stages: perLayer.length + 1,
    layerSteps: perLayer,
    stageNames: Object.fromEntries(named.map((r) => [r.layer, r.name])),
  };
}

const NODE_SELECT = `
  SELECT n.id, n.skill_id, n.kind, n.title, n.description, n.layer, n.x, n.y, n.created_at, n.completed_on, n.session_id,
         s.name AS s_name, sub.name AS s_subject, s.focus_seconds AS s_focus, s.started_at AS s_started
  FROM skill_nodes n
  LEFT JOIN focus_sessions s ON s.id = n.session_id
  LEFT JOIN subjects sub ON sub.id = s.subject_id`;

/** The top-level files of each session (not the pieces extracted from them), oldest first. */
function filesBySession(db: DatabaseSync, sessionIds: number[]): Map<number, SkillFile[]> {
  const out = new Map<number, SkillFile[]>();
  if (sessionIds.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT id, session_id, filename, kind, mime FROM attachments
       WHERE parent_id IS NULL AND session_id IN (${sessionIds.map(() => '?').join(',')}) ORDER BY id`,
    )
    .all(...sessionIds) as { id: number; session_id: number; filename: string; kind: SkillFile['kind']; mime: string }[];
  for (const r of rows) {
    const list = out.get(r.session_id) ?? [];
    list.push({ id: r.id, filename: r.filename, kind: r.kind, mime: r.mime, url: `/api/attachments/${r.id}/file` });
    out.set(r.session_id, list);
  }
  return out;
}

function toNodes(db: DatabaseSync, rows: NodeRow[]): SkillNode[] {
  const files = filesBySession(db, [...new Set(rows.flatMap((r) => (r.session_id !== null ? [r.session_id] : [])))]);
  return rows.map((r) => toNode(r, files.get(r.session_id ?? -1) ?? []));
}

function toNode(r: NodeRow, files: SkillFile[]): SkillNode {
  return {
    id: r.id,
    skillId: r.skill_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    layer: r.layer,
    x: r.x,
    y: r.y,
    createdAt: r.created_at,
    completedOn: r.kind === 'step' ? r.completed_on : null,
    session:
      r.session_id !== null && r.s_name !== null
        ? { id: r.session_id, name: r.s_name, subject: r.s_subject, focusSeconds: r.s_focus ?? 0, startedAt: r.s_started ?? '', files }
        : null,
  };
}

const touch = (db: DatabaseSync, skillId: number, now: Date) =>
  db.prepare('UPDATE skills SET updated_at = ? WHERE id = ?').run(now.toISOString(), skillId);

export function listSkills(db: DatabaseSync): Skill[] {
  const rows = db.prepare('SELECT id, name, created_at, updated_at FROM skills ORDER BY updated_at DESC, id DESC').all() as SkillRow[];
  return rows.map((r) => toSkill(db, r));
}

export function getSkill(db: DatabaseSync, id: number): Skill | null {
  const row = db.prepare('SELECT id, name, created_at, updated_at FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  return row ? toSkill(db, row) : null;
}

const cleanName = (name: unknown): string => {
  if (typeof name !== 'string' || name.trim() === '') throw new SkillInputError('Give the skill a name');
  const trimmed = name.trim();
  if (trimmed.length > 80) throw new SkillInputError('Keep the name under 80 characters');
  return trimmed;
};

export function createSkill(db: DatabaseSync, name: unknown, now: Date): Skill {
  const at = now.toISOString();
  const { lastInsertRowid } = db.prepare('INSERT INTO skills (name, created_at, updated_at) VALUES (?, ?, ?)').run(cleanName(name), at, at);
  return getSkill(db, Number(lastInsertRowid)) as Skill;
}

export function renameSkill(db: DatabaseSync, id: number, name: unknown, now: Date): Skill | null {
  const changes = Number(db.prepare('UPDATE skills SET name = ?, updated_at = ? WHERE id = ?').run(cleanName(name), now.toISOString(), id).changes);
  return changes === 0 ? null : getSkill(db, id);
}

export function deleteSkill(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes) > 0;
}

export function getBoard(db: DatabaseSync, skillId: number): SkillBoard | null {
  const skill = getSkill(db, skillId);
  if (!skill) return null;
  const nodes = toNodes(db, db.prepare(`${NODE_SELECT} WHERE n.skill_id = ? ORDER BY n.id`).all(skillId) as NodeRow[]);
  const links = db
    .prepare(
      `SELECT l.id, l.step_id AS stepId, l.experience_id AS experienceId FROM skill_links l
       JOIN skill_nodes n ON n.id = l.step_id WHERE n.skill_id = ? ORDER BY l.id`,
    )
    .all(skillId) as SkillLink[];
  return { skill, nodes, links };
}

export function getNode(db: DatabaseSync, id: number): SkillNode | null {
  const row = db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(id) as NodeRow | undefined;
  return row ? toNodes(db, [row])[0] : null;
}

type NodeFields = { title?: unknown; description?: unknown; layer?: unknown; x?: unknown; y?: unknown; completedOn?: unknown };
type CleanFields = { title?: string; description?: string; layer?: number; x?: number; y?: number; completedOn?: string | null };

const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Checks the fields given; only those present are returned. */
function cleanFields(f: NodeFields): CleanFields {
  const out: CleanFields = {};
  if (f.completedOn !== undefined) {
    if (f.completedOn !== null && (typeof f.completedOn !== 'string' || !DAY_KEY.test(f.completedOn))) throw new SkillInputError('A completion date is a day like 2026-11-23');
    out.completedOn = f.completedOn;
  }
  if (f.title !== undefined) {
    if (typeof f.title !== 'string' || f.title.length > 120) throw new SkillInputError('A title is text under 120 characters');
    out.title = f.title;
  }
  if (f.description !== undefined) {
    if (typeof f.description !== 'string' || f.description.length > 2000) throw new SkillInputError('A description is text under 2,000 characters');
    out.description = f.description;
  }
  if (f.layer !== undefined) {
    if (typeof f.layer !== 'number' || !Number.isInteger(f.layer) || f.layer < 0 || f.layer > 50) throw new SkillInputError('A stage is a whole number from 0 to 50');
    out.layer = f.layer;
  }
  for (const key of ['x', 'y'] as const) {
    const v = f[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) throw new SkillInputError(`${key} must be a number on the canvas`);
    out[key] = v;
  }
  return out;
}

export function createNode(
  db: DatabaseSync,
  skillId: number,
  input: NodeFields & { kind?: unknown; sessionId?: unknown },
  now: Date,
): SkillNode {
  if (!getSkill(db, skillId)) throw new SkillInputError('No such skill');
  if (input.kind !== 'step' && input.kind !== 'experience') throw new SkillInputError('A node is a step or an experience');
  const f = cleanFields(input);
  let sessionId: number | null = null;
  if (input.kind === 'experience') {
    if (typeof input.sessionId !== 'number' || !Number.isInteger(input.sessionId)) throw new SkillInputError('An experience needs a focus session');
    if (!db.prepare('SELECT 1 FROM focus_sessions WHERE id = ?').get(input.sessionId)) throw new SkillInputError('No such focus session');
    sessionId = input.sessionId;
  }
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO skill_nodes (skill_id, kind, title, description, session_id, layer, x, y, created_at, completed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      skillId,
      input.kind,
      f.title ?? '',
      f.description ?? '',
      sessionId,
      f.layer ?? 0,
      f.x ?? 0,
      f.y ?? 0,
      now.toISOString(),
      // A step is done the day it goes on the canvas unless the client says otherwise (it sends its local day).
      input.kind === 'step' ? (f.completedOn ?? now.toISOString().slice(0, 10)) : null,
    );
  touch(db, skillId, now);
  return getNode(db, Number(lastInsertRowid)) as SkillNode;
}

export function updateNode(db: DatabaseSync, id: number, input: NodeFields, now: Date): SkillNode | null {
  const node = getNode(db, id);
  if (!node) return null;
  const f = cleanFields(input);
  const next = { ...node, ...f };
  db.prepare('UPDATE skill_nodes SET title = ?, description = ?, layer = ?, x = ?, y = ?, completed_on = ? WHERE id = ?').run(
    next.title,
    next.description,
    next.layer,
    next.x,
    next.y,
    node.kind === 'step' ? next.completedOn : null,
    id,
  );
  touch(db, node.skillId, now);
  return getNode(db, id);
}

export function deleteNode(db: DatabaseSync, id: number, now: Date): boolean {
  const node = getNode(db, id);
  if (!node) return false;
  db.prepare('DELETE FROM skill_nodes WHERE id = ?').run(id);
  touch(db, node.skillId, now);
  return true;
}

/** Links an experience to a step of the same skill; linking twice returns the first link. */
export function linkNodes(db: DatabaseSync, stepId: unknown, experienceId: unknown, now: Date): SkillLink {
  if (typeof stepId !== 'number' || typeof experienceId !== 'number') throw new SkillInputError('A link needs a step and an experience');
  const step = getNode(db, stepId);
  const experience = getNode(db, experienceId);
  if (!step || step.kind !== 'step') throw new SkillInputError('Link to a step');
  if (!experience || experience.kind !== 'experience') throw new SkillInputError('Link an experience');
  if (step.skillId !== experience.skillId) throw new SkillInputError('Both belong to the same skill');
  db.prepare('INSERT OR IGNORE INTO skill_links (step_id, experience_id, created_at) VALUES (?, ?, ?)').run(stepId, experienceId, now.toISOString());
  touch(db, step.skillId, now);
  return db
    .prepare('SELECT id, step_id AS stepId, experience_id AS experienceId FROM skill_links WHERE step_id = ? AND experience_id = ?')
    .get(stepId, experienceId) as SkillLink;
}

export function unlink(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare('DELETE FROM skill_links WHERE id = ?').run(id).changes) > 0;
}

/** Names stage `layer` of a skill; a blank name clears it, so the stage shows only its number. */
export function nameStage(db: DatabaseSync, skillId: number, layer: number, name: unknown, now: Date): Skill | null {
  if (!getSkill(db, skillId)) return null;
  if (!Number.isInteger(layer) || layer < 0 || layer > 50) throw new SkillInputError('A stage is a whole number from 0 to 50');
  if (typeof name !== 'string') throw new SkillInputError('A stage name is text');
  const trimmed = name.trim();
  if (trimmed.length > 60) throw new SkillInputError('Keep a stage name under 60 characters');
  if (trimmed === '') db.prepare('DELETE FROM skill_stages WHERE skill_id = ? AND layer = ?').run(skillId, layer);
  else db.prepare('INSERT INTO skill_stages (skill_id, layer, name) VALUES (?, ?, ?) ON CONFLICT (skill_id, layer) DO UPDATE SET name = excluded.name').run(skillId, layer, trimmed);
  touch(db, skillId, now);
  return getSkill(db, skillId);
}
