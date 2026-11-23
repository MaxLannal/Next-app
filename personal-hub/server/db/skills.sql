-- Schema v2: the skill tracker. A skill holds nodes on a canvas split into stages (layer 0 is the
-- foundations, higher layers harder work); a step is what was learned, an experience is a focus
-- session linked to it as evidence. Deleting a skill takes its nodes and links with it.
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('step', 'experience')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  session_id INTEGER REFERENCES focus_sessions(id) ON DELETE SET NULL,
  layer INTEGER NOT NULL DEFAULT 0 CHECK (layer >= 0),
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  experience_id INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (step_id, experience_id)
);
CREATE INDEX IF NOT EXISTS skill_nodes_skill ON skill_nodes(skill_id);
CREATE INDEX IF NOT EXISTS skill_links_step ON skill_links(step_id);
