-- Schema version 1. openDb() runs this once, when PRAGMA user_version is 0.
-- Instants are ISO-8601 UTC text; durations are integer seconds.

CREATE TABLE subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deadline TEXT,
  planned_minutes INTEGER,
  original_deadline TEXT,
  original_planned_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  done_at TEXT
);

CREATE TABLE goal_plan_history (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL,
  deadline TEXT,
  planned_minutes INTEGER
);

CREATE TABLE focus_sessions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id),
  goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'done')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  focus_seconds INTEGER NOT NULL DEFAULT 0,
  auto_paused_at TEXT,
  repo_folder TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('start', 'pause', 'resume', 'stop')),
  at TEXT NOT NULL
);

CREATE TABLE session_tags (
  session_id INTEGER NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, tag_id)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES focus_sessions(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES attachments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'code', 'text', 'latex', 'other')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  preview_path TEXT,
  sha256 TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'github')),
  extracted_text TEXT NOT NULL DEFAULT '',
  vision_status TEXT CHECK (vision_status IN ('pending', 'done', 'failed')),
  repo_path TEXT,
  repo_state TEXT CHECK (repo_state IN ('pending', 'synced', 'failed', 'removed')),
  created_at TEXT NOT NULL
);

CREATE TABLE essays (
  id INTEGER PRIMARY KEY,
  column_key TEXT NOT NULL CHECK (column_key IN ('meditations', 'plans', 'insights')),
  title TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE essay_snapshots (
  id INTEGER PRIMARY KEY,
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'video', 'course', 'link')),
  domain TEXT NOT NULL,
  thumbnail TEXT,
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sleep_samples (
  id INTEGER PRIMARY KEY,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('in_bed', 'asleep', 'awake', 'core', 'deep', 'rem')),
  source TEXT NOT NULL,
  UNIQUE (start, end, stage, source)
);

CREATE TABLE exercise_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pushups', 'squats')),
  count INTEGER NOT NULL CHECK (count > 0),
  logged_at TEXT NOT NULL
);

CREATE TABLE chat_conversations (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);

CREATE INDEX idx_focus_sessions_started_at ON focus_sessions(started_at);
CREATE INDEX idx_session_events_session_id ON session_events(session_id);
CREATE INDEX idx_attachments_session_id ON attachments(session_id);
CREATE INDEX idx_exercise_log_logged_at ON exercise_log(logged_at);
CREATE INDEX idx_sleep_samples_end ON sleep_samples(end);
