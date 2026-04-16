PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  unlock_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'killed')),
  done_state TEXT,
  next_action TEXT,
  weekly_commitment_hours REAL,
  restart_date TEXT,
  killed_reason TEXT,
  killed_lessons TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status_changed_at TEXT
);

CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  domain_id INTEGER REFERENCES domains(id),
  project_id INTEGER REFERENCES projects(id),
  commitment_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'partial', 'skipped')) DEFAULT 'pending',
  reflection_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK(type IN ('morning', 'evening', 'weekly')),
  domain_id INTEGER REFERENCES domains(id),
  project_id INTEGER REFERENCES projects(id),
  status TEXT NOT NULL CHECK(status IN ('done', 'partial', 'skipped')),
  note TEXT,
  skip_reason TEXT
);

CREATE TABLE IF NOT EXISTS streaks (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL UNIQUE REFERENCES domains(id),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_checkin_date TEXT
);

CREATE TABLE IF NOT EXISTS conversation_state (
  chat_id TEXT PRIMARY KEY,
  active_flow TEXT,
  flow_data TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_domain_status ON projects(domain_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_date_status ON commitments(date, status);
CREATE INDEX IF NOT EXISTS idx_commitments_project_date ON commitments(project_id, date);
CREATE INDEX IF NOT EXISTS idx_checkins_timestamp ON checkins(timestamp);
CREATE INDEX IF NOT EXISTS idx_checkins_project_timestamp ON checkins(project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_state_updated_at ON conversation_state(updated_at);
