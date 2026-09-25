// SQLite access and schema for the scanner. One file: data/scanner.db.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = resolve(ROOT, 'data', 'scanner.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- O*NET Occupation Data plus the BLS join and the occupation wage bill.
CREATE TABLE IF NOT EXISTS occupations (
  onet_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  bls_code TEXT,              -- BLS code whose numbers were used (detailed, broad or minor group)
  bls_match TEXT,             -- exact | broad_residual | minor_residual | unmatched
  bls_shared_by INTEGER,      -- number of O*NET occupations splitting that BLS row
  employment REAL,            -- employment allocated to this O*NET occupation
  median_wage REAL,           -- annual median wage used
  wage_source TEXT,           -- annual_median | annual_mean | top_coded_lower_bound
  wage_bill REAL,             -- employment x median_wage
  share_method TEXT           -- ratings | ratings_imputed | equal
);

-- O*NET Task Statements, with the task's share of its occupation's wage bill.
CREATE TABLE IF NOT EXISTS tasks (
  task_id INTEGER PRIMARY KEY,
  onet_code TEXT NOT NULL REFERENCES occupations(onet_code),
  task TEXT NOT NULL,
  task_type TEXT,
  incumbents_responding INTEGER,
  date TEXT,
  domain_source TEXT,
  importance REAL,            -- IM, 1-5
  relevance REAL,             -- RT, percent 0-100
  frequency REAL,             -- FT, expected category 1 (yearly or less) .. 7 (hourly or more)
  weight REAL,                -- importance x relevance/100 (imputed when missing)
  share REAL,                 -- weight / sum of weights in the occupation
  labor_value REAL            -- share x occupation wage_bill (NULL when no BLS data)
);
CREATE INDEX IF NOT EXISTS tasks_onet ON tasks(onet_code);

-- O*NET Task Ratings as published (long format).
CREATE TABLE IF NOT EXISTS task_ratings (
  onet_code TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  scale_id TEXT NOT NULL,
  category TEXT,
  data_value REAL,
  n INTEGER,
  standard_error REAL,
  lower_ci REAL,
  upper_ci REAL,
  recommend_suppress TEXT,
  date TEXT,
  domain_source TEXT
);
CREATE INDEX IF NOT EXISTS task_ratings_task ON task_ratings(task_id, scale_id);

-- O*NET Work Context (occupation level). cx = mean on the CX/CT context scale.
CREATE TABLE IF NOT EXISTS work_context (
  onet_code TEXT NOT NULL,
  element_id TEXT NOT NULL,
  element_name TEXT,
  scale_id TEXT NOT NULL,     -- CX (1-5) or CT (1-3)
  data_value REAL,
  n INTEGER,
  recommend_suppress TEXT,
  PRIMARY KEY (onet_code, element_id, scale_id)
);

-- O*NET Work Activities (occupation level): importance (IM 1-5) and level (LV 0-7).
CREATE TABLE IF NOT EXISTS work_activities (
  onet_code TEXT NOT NULL,
  element_id TEXT NOT NULL,
  element_name TEXT,
  im REAL,
  lv REAL,
  PRIMARY KEY (onet_code, element_id)
);

-- Detailed Work Activities: the task-level link into O*NET's activity taxonomy.
CREATE TABLE IF NOT EXISTS dwa_reference (
  dwa_id TEXT PRIMARY KEY,
  dwa_title TEXT,
  iwa_id TEXT,
  gwa_id TEXT
);
CREATE TABLE IF NOT EXISTS task_dwas (
  task_id INTEGER NOT NULL,
  onet_code TEXT NOT NULL,
  dwa_id TEXT NOT NULL,
  PRIMARY KEY (task_id, onet_code, dwa_id)
);

-- BLS OEWS national, cross-industry estimates.
CREATE TABLE IF NOT EXISTS bls_oews (
  bls_code TEXT PRIMARY KEY,  -- formatted, e.g. 13-2011
  title TEXT,
  display_level INTEGER,      -- as served by BLS (tree indentation); SOC level is derived from the code
  employment REAL,
  annual_mean REAL,
  annual_median REAL,
  employment_raw TEXT,
  annual_mean_raw TEXT,
  annual_median_raw TEXT
);

-- One row per task per question-set hash: every Jev answer, cached.
CREATE TABLE IF NOT EXISTS jev_answers (
  task_id INTEGER NOT NULL,
  qset_hash TEXT NOT NULL,
  model_requested TEXT NOT NULL,
  model_reported TEXT,
  request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  answered_at TEXT NOT NULL,
  run_id INTEGER,
  answers_json TEXT NOT NULL, -- the full answers object as returned
  reads_text REAL, closed_outcome REAL, writes_content REAL, physical REAL, live_human REAL,
  same_rules REAL, recoverable_loss REAL, outcome_visible REAL, speed_value REAL,
  digital_input REAL, licensed_signoff REAL,
  time_per_item REAL, time_per_item_conf REAL,
  volume REAL, volume_conf REAL,
  money_link REAL, money_link_conf REAL,
  buyer TEXT, buyer_conf REAL,
  sell_model TEXT, sell_model_conf REAL,
  PRIMARY KEY (task_id, qset_hash)
);

-- Every question set that has been used, so each cached answer can be traced to its wording.
CREATE TABLE IF NOT EXISTS question_sets (
  qset_hash TEXT PRIMARY KEY,
  label TEXT,
  created_at TEXT,
  questions_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT,
  qset_hash TEXT,
  model TEXT,
  started_at TEXT,
  finished_at TEXT,
  tasks_planned INTEGER,
  tasks_cached INTEGER,
  requests_ok INTEGER DEFAULT 0,
  requests_failed INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  status TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS request_errors (
  run_id INTEGER,
  task_id INTEGER,
  at TEXT,
  status INTEGER,
  request_id TEXT,
  message TEXT
);
`;

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Additive migrations for databases created before a column existed.
  const addColumn = (table, column, type) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('tasks', 'frequency', 'REAL');
  // Question design split recoverable_loss in two and made physical a Score question.
  addColumn('jev_answers', 'errors_lose_money', 'REAL');
  addColumn('jev_answers', 'loss_recoverable', 'REAL');
  addColumn('jev_answers', 'physical_conf', 'REAL');
  addColumn('jev_answers', 'min_score_conf', 'REAL');
  return db;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
