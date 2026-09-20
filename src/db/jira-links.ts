import type { DatabaseSync } from 'node:sqlite'
import type { JiraLinkRow } from './rows.ts'
import { queryAll, queryOne } from './query.ts'

interface RawJiraLink {
  entry_id: number
  issue_key: string | null
  worklog_id: string | null
  linked_at: string
}

function toLink(raw: RawJiraLink): JiraLinkRow {
  return {
    entryId: raw.entry_id,
    issueKey: raw.issue_key,
    worklogId: raw.worklog_id,
    linkedAt: raw.linked_at,
  }
}

export interface NewJiraLink {
  entryId: number
  issueKey: string | null
  worklogId?: string | null
  linkedAt: string
}

export function linkEntry(db: DatabaseSync, link: NewJiraLink): void {
  db.prepare(
    `INSERT INTO jira_links (entry_id, issue_key, worklog_id, linked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (entry_id) DO UPDATE SET
       issue_key = excluded.issue_key,
       worklog_id = excluded.worklog_id,
       linked_at = excluded.linked_at`,
  ).run(link.entryId, link.issueKey, link.worklogId ?? null, link.linkedAt)
}

export function findLink(db: DatabaseSync, entryId: number): JiraLinkRow | undefined {
  const raw = queryOne<RawJiraLink>(
    db.prepare('SELECT * FROM jira_links WHERE entry_id = ?'),
    entryId,
  )
  return raw ? toLink(raw) : undefined
}

export function listLinksForIssue(db: DatabaseSync, issueKey: string): JiraLinkRow[] {
  const raws = queryAll<RawJiraLink>(
    db.prepare('SELECT * FROM jira_links WHERE issue_key = ? ORDER BY entry_id'),
    issueKey,
  )
  return raws.map(toLink)
}

export function unlinkEntry(db: DatabaseSync, entryId: number): boolean {
  return db.prepare('DELETE FROM jira_links WHERE entry_id = ?').run(entryId).changes > 0
}
