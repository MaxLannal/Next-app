-- Schema v3: a step's completion date, the names given to a skill's stages, and a node's y kept
-- relative to the top of its stage (stages now grow with what they hold, so an absolute y would
-- drift). The old stages were 300 tall and stacked upward from y = 0.
ALTER TABLE skill_nodes ADD COLUMN completed_on TEXT;
UPDATE skill_nodes SET completed_on = date(created_at, 'localtime') WHERE kind = 'step';
UPDATE skill_nodes SET y = y + (layer + 1) * 300;
CREATE TABLE IF NOT EXISTS skill_stages (
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  layer INTEGER NOT NULL CHECK (layer >= 0),
  name TEXT NOT NULL,
  PRIMARY KEY (skill_id, layer)
);
