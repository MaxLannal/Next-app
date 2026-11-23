-- Schema v5: traces, the places on the globe — where, when, what happened there, its photos,
-- and the essays written about it.
CREATE TABLE traces (
  id INTEGER PRIMARY KEY,
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  day TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE trace_photos (
  id INTEGER PRIMARY KEY,
  trace_id INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX trace_photos_trace ON trace_photos(trace_id);

CREATE TABLE trace_essays (
  trace_id INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  PRIMARY KEY (trace_id, essay_id)
);
