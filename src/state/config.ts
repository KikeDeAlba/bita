import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_STORY_THEMES, type StoryTheme } from '../config/constants.ts'
import os from 'node:os'
import path from 'node:path'

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'bita')
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export type HierarchyStrategy = 'epic-story-subtask' | 'story-subtask' | 'flat-task'

export interface StoryRef {
  key: string
  summary: string
  verifiedAt: string
}

export interface ProjectMapping {
  projectName: string
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

export interface ScopeMapping {
  projectId: number
  projectName: string
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
  scopeMapping: Record<string, ScopeMapping>
}

export function emptyConfig(): AppConfig {
  return { version: 1, projectMapping: {}, scopeMapping: {} }
}

export const LEGACY_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'toggl-track-cli',
  'config.json',
)

interface LegacyProjectMapping extends ProjectMapping {
  togglProjectName?: string
}

interface LegacyScopeMapping extends ScopeMapping {
  togglProjectId?: number
  togglProjectName?: string
  workspaceId?: number
}

export function migrateLegacyKeys(parsed: Partial<AppConfig>): Partial<AppConfig> {
  const projectMapping: Record<string, ProjectMapping> = {}
  for (const [key, value] of Object.entries(parsed.projectMapping ?? {})) {
    const legacy = value as LegacyProjectMapping
    const { togglProjectName, ...rest } = legacy
    projectMapping[key] = { ...rest, projectName: rest.projectName ?? togglProjectName ?? '' }
  }

  const legacyScopes = (parsed as { repoMapping?: Record<string, unknown> }).repoMapping
  const scopeMapping: Record<string, ScopeMapping> = {}
  for (const [key, value] of Object.entries(parsed.scopeMapping ?? legacyScopes ?? {})) {
    const legacy = value as LegacyScopeMapping
    const { togglProjectId, togglProjectName, workspaceId, ...rest } = legacy
    scopeMapping[key] = {
      ...rest,
      projectId: rest.projectId ?? togglProjectId ?? 0,
      projectName: rest.projectName ?? togglProjectName ?? '',
    }
  }

  const { repoMapping: _dropped, ...withoutLegacy } = parsed as Partial<AppConfig> & {
    repoMapping?: unknown
  }
  return { ...withoutLegacy, projectMapping, scopeMapping }
}

export async function readConfig(configPath = CONFIG_PATH): Promise<AppConfig> {
  try {
    let raw: string
    try {
      raw = await readFile(configPath, 'utf8')
    } catch {
      raw = await readFile(LEGACY_CONFIG_PATH, 'utf8')
    }
    const parsed = migrateLegacyKeys(JSON.parse(raw) as Partial<AppConfig>)
    return {
      version: parsed.version ?? 1,
      ...(parsed.workspaceId !== undefined ? { workspaceId: parsed.workspaceId } : {}),
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
      ...(parsed.jira !== undefined ? { jira: parsed.jira } : {}),
      ...(parsed.defaults !== undefined ? { defaults: parsed.defaults } : {}),
      projectMapping: parsed.projectMapping ?? {},
      scopeMapping: parsed.scopeMapping ?? {},
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
  projectId: number,
  mapping: ProjectMapping,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  config.projectMapping[String(projectId)] = mapping
  await writeConfig(config, configPath)
  return config
}

export async function unsetProjectMapping(
  projectId: number,
  configPath = CONFIG_PATH,
): Promise<boolean> {
  const config = await readConfig(configPath)
  const key = String(projectId)
  if (!(key in config.projectMapping)) return false
  delete config.projectMapping[key]
  await writeConfig(config, configPath)
  return true
}

export async function setScopeMapping(
  slug: string,
  mapping: ScopeMapping,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  config.scopeMapping[slug] = mapping
  await writeConfig(config, configPath)
  return config
}

export async function unsetScopeMapping(slug: string, configPath = CONFIG_PATH): Promise<boolean> {
  const config = await readConfig(configPath)
  if (!(slug in config.scopeMapping)) return false
  delete config.scopeMapping[slug]
  await writeConfig(config, configPath)
  return true
}

export function storyThemes(config: AppConfig): StoryTheme[] {
  const configured = config.defaults?.storyThemes
  return configured && configured.length > 0 ? configured : [...DEFAULT_STORY_THEMES]
}

export async function setStory(
  projectId: number,
  themeId: string,
  story: StoryRef,
  configPath = CONFIG_PATH,
): Promise<AppConfig> {
  const config = await readConfig(configPath)
  const key = String(projectId)
  const mapping = config.projectMapping[key]
  if (!mapping) throw new Error(`Toggl project ${projectId} is not mapped to a Jira project.`)
  mapping.stories = { ...mapping.stories, [themeId]: story }
  await writeConfig(config, configPath)
  return config
}
