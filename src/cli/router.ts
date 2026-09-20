import { UsageError } from '../errors.ts'
import { runProjects } from './commands/catalog.ts'
import { runProject } from './commands/project.ts'
import { runEntries } from './commands/entries.ts'
import { runSummary } from './commands/summary.ts'
import { runMap } from './commands/map.ts'
import { runConfig } from './commands/config.ts'
import { runRepo } from './commands/repo.ts'
import { runScope } from './commands/scope.ts'
import { runAmend } from './commands/amend.ts'
import { runNote } from './commands/note.ts'
import { runHook } from './commands/hook.ts'
import { runLink } from './commands/link.ts'
import { runCancel, runCurrent, runLog, runStart, runStop } from './commands/timer.ts'
import { writeOut } from './output.ts'

export const VERSION = '0.1.0'

const HELP = `bita ${VERSION}

Usage: bita <command> [options]

Tracking:
  start ["<title>"]          Start a timer, blank or titled; several may run at once
  ls                         Show every running timer
  stop [id]                  Stop one timer (--last, --all, or pick when ambiguous)
  cancel [id]                Discard a running timer without recording it
  log "<title>"              Record a block that already happened
  amend <id|--draft>         Fill in the title, project or note of an entry
  note get|set <entryId>     Read or attach the rich note of an entry
  link <ids...> --issue K    Mark entries as registered in a Jira issue

Reporting:
  entries [preset]           List time entries
  summary [preset]           Group entries into Jira-ready tasks
  projects                   List projects and their Jira mapping
  project add "<name>"       Create a project (also rename, archive)

Configuration:
  map list|set|unset|story   Map projects to Jira projects, parents and stories
  repo init [path]           Create a project for a repository and map it
  repo show                  Where am I, and which project resolves here
  scope list|set|unset|which Map a path prefix to a project; the longest one wins
  config get|set-jira        Inspect or set the local configuration
  hook session-start         Emit the Claude Code SessionStart context

Range presets:
  today, yesterday, week, last-week, month, last-month

Common options:
  --json                     Emit one JSON document on stdout
  --from YYYY-MM-DD          Range start (inclusive)
  --to YYYY-MM-DD            Range end (inclusive)
  --last-days N              Rolling window ending today
  --pending                  Only entries not yet registered in Jira
  --registered               Only entries already registered in Jira
  --include-running          Count entries whose timer is still running
  --timezone TZ              Override the timezone
  --db-path FILE             Use this database instead of the default

Summary options:
  --max-task-hours N         Cap per task before splitting (default 8)
  --estimate-step-minutes N  Round the original estimate up to this step (default 30)
  --case-insensitive         Group descriptions ignoring case and accents
  --no-notes                 Skip the rich notes

Timer options:
  --project ID|NAME          Project; otherwise inferred from the repository
  --at HH:MM                 Start or stop at this time instead of now
  --all                      stop or cancel every running timer
  --last                     stop or cancel the most recently started one
  --require-running          stop fails when nothing is running

Log options:
  --from HH:MM               When the block started (required)
  --to HH:MM                 When it ended
  --for 1h30m                How long it lasted, instead of --to

Project options:
  --name NAME                With "repo init", the project name (default: the repo folder)
  --client NAME              Client the project belongs to
  --activate                 With "project archive", bring it back instead
  --all                      With "projects", include archived ones

Amend options:
  --draft                    Target the single running draft
  --title "..."              Set the title
  --project ID|NAME          Set the project
  --note-json FILE           Attach a rich note

Link options:
  --issue KEY                The Jira issue the entries were written to
  --ids A,B,C                Entry ids, as an alternative to positionals
  --unlink                   Undo the link, putting the entries back to pending

Note options:
  --note-json FILE           Rich note as JSON (summary plus what was touched)
  --note-file FILE           Rich note body as plain text
  --file / --command / --resource   Artifacts touched, repeatable
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
    case 'projects':
      return runProjects(rest)
    case 'project':
      return runProject(rest)
    case 'entries':
      return runEntries(rest)
    case 'summary':
    case 'groups':
      return runSummary(rest)
    case 'map':
      return runMap(rest)
    case 'config':
      return runConfig(rest)
    case 'repo':
      return runRepo(rest)
    case 'scope':
      return runScope(rest)
    case 'amend':
      return runAmend(rest)
    case 'note':
      return runNote(rest)
    case 'hook':
      return runHook(rest)
    case 'link':
      return runLink(rest)
    case 'start':
      return runStart(rest)
    case 'stop':
      return runStop(rest)
    case 'log':
      return runLog(rest)
    case 'ls':
    case 'current':
    case 'running':
      return runCurrent(rest)
    case 'cancel':
    case 'discard':
      return runCancel(rest)
    default:
      throw new UsageError(`Unknown command "${command}". Run "bita --help" for the list.`)
  }
}
