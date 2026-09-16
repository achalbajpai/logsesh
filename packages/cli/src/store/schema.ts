export const INDEX_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  tool TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  lifecycle TEXT,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  fingerprint TEXT,
  adapter_version TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  completeness TEXT NOT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  project_path TEXT,
  branch TEXT,
  model TEXT,
  parent_session_id TEXT,
  agent_id TEXT,
  agent_type TEXT,
  originator TEXT,
  depth INTEGER,
  started_at TEXT,
  ended_at TEXT,
  turn_count INTEGER NOT NULL,
  total_tokens INTEGER,
  cost_usd REAL,
  usage_json TEXT,
  completeness TEXT NOT NULL,
  warnings_json TEXT,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS turns (
  session_key TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  timestamp TEXT,
  text_content TEXT,
  PRIMARY KEY(session_key, turn_index),
  FOREIGN KEY(session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_calls (
  session_key TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  call_id TEXT,
  name TEXT NOT NULL,
  status TEXT,
  input_text TEXT,
  output_text TEXT,
  FOREIGN KEY(session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);
`;

export const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  session_key UNINDEXED,
  content,
  tokenize = 'unicode61'
);
`;
