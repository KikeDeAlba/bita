export const LOCAL_PROJECT_ID_CEILING = 100_000_000

export interface Migration {
  readonly version: number
  readonly statements: readonly string[]
}

const INITIAL_SCHEMA: readonly string[] = [
  `CREATE TABLE projects (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     client_name TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     external_id INTEGER UNIQUE,
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX projects_name_unique ON projects (name COLLATE NOCASE)`,

  `CREATE TABLE entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER REFERENCES projects (id) ON DELETE SET NULL,
     description TEXT NOT NULL,
     started_at TEXT NOT NULL,
     stopped_at TEXT,
     billable INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL,
     external_id INTEGER UNIQUE,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     CHECK (stopped_at IS NULL OR stopped_at >= started_at)
   )`,
  `CREATE INDEX entries_started_at ON entries (started_at)`,
  `CREATE INDEX entries_project ON entries (project_id)`,
  `CREATE INDEX entries_running ON entries (started_at) WHERE stopped_at IS NULL`,

  `CREATE TABLE notes (
     entry_id INTEGER PRIMARY KEY REFERENCES entries (id) ON DELETE CASCADE,
     body TEXT NOT NULL,
     files TEXT NOT NULL DEFAULT '[]',
     commands TEXT NOT NULL DEFAULT '[]',
     resources TEXT NOT NULL DEFAULT '[]',
     repo_slug TEXT,
     branch TEXT,
     head_sha TEXT,
     recorded_at TEXT NOT NULL
   )`,

  `CREATE TABLE jira_links (
     entry_id INTEGER PRIMARY KEY REFERENCES entries (id) ON DELETE CASCADE,
     issue_key TEXT,
     worklog_id TEXT,
     linked_at TEXT NOT NULL
   )`,
  `CREATE INDEX jira_links_issue ON jira_links (issue_key)`,

  `CREATE TABLE jira_project_map (
     project_id INTEGER PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
     jira_key TEXT NOT NULL,
     epic_key TEXT,
     epic_resolved INTEGER NOT NULL DEFAULT 0,
     hierarchy TEXT NOT NULL,
     story_type TEXT,
     work_type TEXT,
     done_transition_id TEXT,
     done_transition_name TEXT,
     timetracking_available INTEGER,
     verified_at TEXT
   )`,

  `CREATE TABLE story_cache (
     project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     theme_id TEXT NOT NULL,
     issue_key TEXT NOT NULL,
     summary TEXT NOT NULL,
     verified_at TEXT NOT NULL,
     PRIMARY KEY (project_id, theme_id)
   )`,

  `CREATE TABLE repo_map (
     slug TEXT PRIMARY KEY,
     project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     slug_source TEXT NOT NULL,
     verified_at TEXT
   )`,

  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
]

const ENTRY_TOUCHES: readonly string[] = [
  `CREATE TABLE entry_touches (
     entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
     path TEXT NOT NULL,
     first_seen_at TEXT NOT NULL,
     PRIMARY KEY (entry_id, path)
   )`,
  `CREATE INDEX entry_touches_entry ON entry_touches (entry_id)`,
]

const ENTRY_DOCS: readonly string[] = [
  `CREATE TABLE entry_docs (
     entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
     rel_path TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'note',
     title TEXT NOT NULL DEFAULT '',
     title_slug TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL,
     section_count INTEGER NOT NULL DEFAULT 0,
     byte_size INTEGER NOT NULL DEFAULT 0,
     checksum TEXT NOT NULL DEFAULT '',
     repo_slug TEXT,
     branch TEXT,
     head_sha TEXT,
     created_at TEXT NOT NULL,
     recorded_at TEXT NOT NULL,
     PRIMARY KEY (entry_id, rel_path),
     CHECK (kind IN ('note', 'appendix')),
     CHECK (rel_path <> '' AND rel_path NOT LIKE '/%' AND rel_path NOT LIKE '%..%')
   )`,
  `CREATE UNIQUE INDEX entry_docs_path ON entry_docs (rel_path)`,
  `CREATE INDEX entry_docs_entry ON entry_docs (entry_id, kind)`,
  `CREATE INDEX entry_docs_recorded ON entry_docs (recorded_at)`,
  `DROP TABLE notes`,
]

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: INITIAL_SCHEMA },
  { version: 2, statements: ENTRY_TOUCHES },
  { version: 3, statements: ENTRY_DOCS },
]

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
)
