import { localDay } from '../domain/timezone.ts'
import { projectSlug, titleSlug } from './slug.ts'

export type DocKind = 'note' | 'appendix'

export interface DocPathInput {
  entryId: number
  startedAt: string
  timezone: string
  projectName: string | null
  description: string
  kind?: DocKind
  suffix?: string
}

export function docDay(startedAt: string, timezone: string): string {
  return localDay(startedAt, timezone)
}

export function docRelPath(input: DocPathInput): string {
  const day = docDay(input.startedAt, input.timezone)
  const [year, month, dayOfMonth] = day.split('-')
  const slug = titleSlug(input.description)
  const suffix = input.kind === 'appendix' && input.suffix ? `--${titleSlug(input.suffix)}` : ''

  return [
    projectSlug(input.projectName),
    year,
    month,
    `${dayOfMonth}-${input.entryId}-${slug}${suffix}.md`,
  ].join('/')
}
