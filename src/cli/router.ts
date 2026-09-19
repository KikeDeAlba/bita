import { UsageError } from '../http/errors.ts'
import { runAuth } from './commands/auth.ts'
import { runWhoami } from './commands/whoami.ts'
import { runProjects, runTags } from './commands/catalog.ts'
import { runEntries } from './commands/entries.ts'
import { runSummary } from './commands/summary.ts'
import { runTag } from './commands/tag.ts'
import { runMap } from './commands/map.ts'
import { runConfig } from './commands/config.ts'
import { writeOut } from './output.ts'

export const VERSION = '0.1.0'

const HELP = `toggl-track-cli ${VERSION}

Usage: toggl <command> [options]

Commands:
  auth login|status|logout   Manage the API token in the macOS keychain
  whoami                     Show the account, workspace and timezone
  projects                   List Toggl projects and their Jira mapping
  tags                       List the tags of the workspace
  entries [preset]           List time entries
  summary [preset]           Group entries into Jira-ready tasks
  tag <ids...>               Add or remove tags (dry run unless --apply)
  map list|set|unset         Map Toggl projects to Jira projects and parents
  config get|set-jira        Inspect or set the local configuration

Range presets:
  today, yesterday, week, last-week, month, last-month

Common options:
  --json                     Emit one JSON document on stdout
  --from YYYY-MM-DD          Range start (inclusive)
  --to YYYY-MM-DD            Range end (inclusive)
  --last-days N              Rolling window ending today
  --pending                  Shorthand for --tag pending
  --registered               Shorthand for --tag registered
  --tag NAME                 Filter by tag (repeatable)
  --exclude-tag NAME         Exclude a tag (repeatable)
  --tag-match any|all        How to combine several --tag values
  --untagged                 Only entries without any tag
  --include-running          Count entries whose timer is still running
  --workspace ID             Override the workspace
  --timezone TZ              Override the timezone
  --source auto|me|reports   Force an endpoint
  --no-cache                 Refresh the project and tag catalog
  --verbose                  Log every HTTP request to stderr
  --offline                  Use the cached catalog and skip the /me call

Summary options:
  --max-task-hours N         Cap per task before splitting (default 8)
  --case-insensitive         Group descriptions ignoring case and accents

Tag options:
  --add NAME                 Tag to add (repeatable)
  --remove NAME              Tag to remove (repeatable)
  --ids A,B,C                Entry ids, as an alternative to positionals
  --apply                    Actually write; without it this is a dry run
  --yes                      Skip the interactive confirmation
  --no-verify                Skip the read-back verification
  --strategy patch|put       Bulk patch or one entry at a time
`

export async function route(argv: string[]): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    writeOut(HELP)
    return 0
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    writeOut(VERSION)
    return 0
  }

  if (rest.includes('--help')) {
    writeOut(HELP)
    return 0
  }

  switch (command) {
    case 'auth':
      return runAuth(rest)
    case 'whoami':
      return runWhoami(rest)
    case 'projects':
      return runProjects(rest)
    case 'tags':
      return runTags(rest)
    case 'entries':
      return runEntries(rest)
    case 'summary':
    case 'groups':
      return runSummary(rest)
    case 'tag':
      return runTag(rest)
    case 'map':
      return runMap(rest)
    case 'config':
      return runConfig(rest)
    default:
      throw new UsageError(`Unknown command "${command}". Run "toggl --help" for the list.`)
  }
}
