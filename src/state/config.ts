import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_STORY_THEMES, type StoryTheme } from '../config/constants.ts'
import os from 'node:os'
import path from 'node:path'

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'toggl-track-cli')
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export type HierarchyStrategy = 'epic-story-subtask' | 'story-subtask' | 'flat-task'

export interface StoryRef {
  key: string
  summary: string
  verifiedAt: string
}

export interface ProjectMapping {
  togglProjectName: string
  jiraProjectKey: string
  hierarchy?: HierarchyStrategy
  epicResolved?: boolean
  stories?: Record<string, StoryRef>
  storyIssueTypeName?: string
  workIssueTypeName?: string
  parentKey?: string
  issueTypeName?: string
  issueTypeId?: string
  doneTransition?: { id: string; name: string }
  timetrackingAvailable?: boolean
  verifiedAt?: string
}

export type RepoSlugSource = 'remote' | 'path' | 'basename'

export interface RepoMapping {
  togglProjectId: number
  togglProjectName: string
  workspaceId?: number
  slugSource: RepoSlugSource
  verifiedAt?: string
}

export interface JiraConfig {
  cloudId?: string
  siteUrl?: string
  accountId?: string
}

export interface AppConfig {
  version: number
  workspaceId?: number
  timezone?: string
  jira?: JiraConfig
  defaults?: { issueTypeName?: string; pendingTagName?: string; storyThemes?: StoryTheme[] }
  projectMapping: Record<string, ProjectMapping>
  repoMapping: Record<string, RepoMapping>
}

export function emptyConfig(): AppConfig {
  return { version: 1, projectMapping: {}, repoMapping: {} }
}

export async function readConfig(configPath = CONFIG_PATH): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      version: parsed.version ?? 1,
      ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
      ...(parsed.jira !== undefined ? { jira: parsed.jira } : {}),
      ...(parsed.defaults !== undefined ? { defaults: parsed.defaults } : {}),
      projectMapping: parsed.projectMapping ?? {},
      repoMapping: parsed.repoMapping ?? {},
    }
  } catch {
    return emptyConfig()
  }
}

export async function writeConfig(config: AppConfig, configPath = CONFIG_PATH): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function setProjectMapping(
  togglProjectId: number,
  mapping: ProjectMapping,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  config.projectMapping[String(togglProjectId)] = mapping
  await writeConfig(config, configPath)
  return config
}

export async function unsetProjectMapping(
  togglProjectId: number,
  configPath = CONFIG_PATH,
): Promise<boolean> {
  const config = await readConfig(configPath)
  const key = String(togglProjectId)
  if (!(key in config.projectMapping)) return false
  delete config.projectMapping[key]
  await writeConfig(config, configPath)
  return true
}

export async function setRepoMapping(
  slug: string,
  mapping: RepoMapping,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  config.repoMapping[slug] = mapping
  await writeConfig(config, configPath)
  return config
}

export async function unsetRepoMapping(slug: string, configPath = CONFIG_PATH): Promise<boolean> {
  const config = await readConfig(configPath)
  if (!(slug in config.repoMapping)) return false
  delete config.repoMapping[slug]
  await writeConfig(config, configPath)
  return true
}

export function storyThemes(config: AppConfig): StoryTheme[] {
  const configured = config.defaults?.storyThemes
  return configured && configured.length > 0 ? configured : [...DEFAULT_STORY_THEMES]
}

export async function setStory(
  togglProjectId: number,
  themeId: string,
  story: StoryRef,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  const key = String(togglProjectId)
  const mapping = config.projectMapping[key]
  if (!mapping) throw new Error(`Toggl project ${togglProjectId} is not mapped to a Jira project.`)
  mapping.stories = { ...mapping.stories, [themeId]: story }
  await writeConfig(config, configPath)
  return config
}
