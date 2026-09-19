import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'toggl-track-cli')
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export interface ProjectMapping {
  togglProjectName: string
  jiraProjectKey: string
  issueTypeName?: string
  issueTypeId?: string
  doneTransition?: { id: string; name: string }
  timetrackingAvailable?: boolean
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
  defaults?: { issueTypeName?: string }
  projectMapping: Record<string, ProjectMapping>
}

export function emptyConfig(): AppConfig {
  return { version: 1, projectMapping: {} }
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
