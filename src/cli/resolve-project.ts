import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig, ScopeMapping } from '../state/config.ts'
import { resolveScopeForSlug, suggestProjectForSlug } from '../domain/repo.ts'
import { listProjects } from '../db/projects.ts'

export interface ResolvedProject {
  projectId: number
  projectName: string
  prefix: string
  via: 'scope' | 'suggestion'
}

export function resolveMappedProject(slug: string, config: AppConfig): ResolvedProject | null {
  const match = resolveScopeForSlug<ScopeMapping>(slug, config.scopeMapping)
  if (!match) return null
  return {
    projectId: match.scope.projectId,
    projectName: match.scope.projectName,
    prefix: match.prefix,
    via: 'scope',
  }
}

export function suggestProject(
  db: DatabaseSync,
  slug: string,
  config: AppConfig,
): ResolvedProject | null {
  const mapped = resolveMappedProject(slug, config)
  if (mapped) return mapped

  const suggestion = suggestProjectForSlug(slug, listProjects(db, true))
  if (!suggestion) return null

  return {
    projectId: suggestion.project.id,
    projectName: suggestion.project.name,
    prefix: suggestion.prefix,
    via: 'suggestion',
  }
}
