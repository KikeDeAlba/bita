# toggl-track-cli

Reads Toggl Track time entries and turns them into Jira-ready tasks. The CLI does
the API work, the date arithmetic and the grouping; the `toggl-jira` Claude Code
skill in `skill/` drives Jira on top of its JSON output.

## Why it exists

Time is tracked in Toggl and has to end up in Jira as real worklogs, not as
guessed estimates. Each Toggl entry carries a title, a project and a state tag:
`pending` until it reaches Jira, `registered` afterwards. The tag is the source of
truth, so the flow is safe to re-run.

## Requirements

Node 22.18 or newer (the CLI runs TypeScript directly, no build step) and macOS
for the keychain integration.

```sh
pnpm install
ln -sfn "$PWD/src/bin/toggl.ts" ~/Library/pnpm/bin/toggl
```

The symlink points at the source, so edits take effect with no reinstall.
`pnpm link --global` no longer exists in pnpm 11.

## Authentication

The token lives in the macOS keychain under the service `toggl-track`. It is never
passed through `argv`, so it never shows up in `ps` or in the shell history.

```sh
toggl auth login       # prompts, verifies against /me, then stores it
toggl auth status
toggl auth logout
```

`TOGGL_API_TOKEN` takes precedence over the keychain, which keeps CI and one-off
runs working. Get a token at https://track.toggl.com/profile.

## The live timer

Claude proposes starting a timer when a session is about to leave an artifact —
a commit, a file, a deployed resource, a migration, a merge request, a root
cause — and not when it will only produce an answer. The bridge rule is the one
already in the user's own guide: **if the work is going to enter a worktree, the
timer starts.**

```sh
toggl start "Ajustar el pipeline"      # 1 call, tagged Pending, project from the repo
toggl current                          # 1 call
toggl stop --note-json /tmp/note.json  # 1 call on the happy path
toggl cancel --yes                     # discards a mis-started entry
```

`start` refuses when something is already running and exits 9. That is not
politeness: a `POST` with a negative duration **silently stops** the previous
entry, so accepting it would truncate a session with nobody noticing. Use
`--switch` to close the previous one on purpose.

The happy path of `stop` costs one call because a local mirror of the running
entry lives in `~/.local/state/toggl-track-cli/running.json`. When the mirror is
missing or older than twelve hours, it reconciles against the `current` endpoint
for one extra call.

### The rich note

Toggl's description is the grouping key and the Jira summary, so it stays short.
The write-up goes to an append-only sidecar,
`~/.local/state/toggl-track-cli/entry-notes.ndjson`, and `summary --json`
exposes it per group as `notes[]`. A line that does not parse is skipped rather
than blinding the whole file, and the last record for an entry wins.

```json
{
  "body": "Two to four sentences on what was done and why.",
  "artifacts": {
    "files": ["src/x.ts"],
    "commands": ["terraform apply"],
    "resources": ["https://…"]
  }
}
```

Losing the sidecar degrades the issue description back to the block table; it
never affects the time itself.

### Repository to project

```sh
toggl repo show                 # the slug inferred here, and its mapping
toggl repo set . 222494997      # remember it
```

The slug comes from the git remote when there is one, normalised so that the ssh
and https forms collapse to the same value, and from the path under `~/dev`
otherwise. Nothing assumes a fixed directory depth.

## The Jira hierarchy

Levels in this tenant: `Epic` = 1, `Historia`/`Tarea`/`Error` = 0,
`Subtarea` = −1, and a parent must sit above its child. **A Historia therefore
cannot contain Tareas, only Subtareas**, which is why work items are subtasks:

```
Epic        the project container, already there
  └─ Historia     the theme, inferred from a closed vocabulary, reused
       └─ Subtarea    one Toggl group, with its worklogs
```

Time rolls up Subtarea → Historia → Epic. The Historia is a container: it is
never estimated and **never closed**, because closing it would orphan the
subtasks that come later.

Story names come from a closed list in `defaults.storyThemes`, cached per theme
id in the mapping so renaming the visible name breaks nothing. Matching an
existing story uses exact normalised equality, never Jira's `~` operator, which
tokenises and would match "Infraestructura de pruebas del cliente" for
"Infraestructura".

## Commands

```sh
toggl whoami
toggl projects                       # Toggl projects and their Jira mapping
toggl tags
toggl entries week
toggl summary --pending --json       # what the skill consumes
toggl tag 123 456 --add registered --remove pending --apply
toggl map set 209876543 DPF --issue-type "Tarea"
toggl config get
```

Range presets: `today`, `yesterday`, `week`, `last-week`, `month`, `last-month`,
or `--from`/`--to` (both inclusive) and `--last-days N`.

## Grouping rules

One Jira task per **project + title**, across the whole range. A task that spans
several days stays one task. Inside it, **one worklog per Toggl entry**, each with
its real start time; the group total becomes the original estimate.

The **original estimate is rounded up to the next half hour** while the worklogs
keep the exact Toggl time: 3h 43m of tracked work becomes a 4h estimate made of
worklogs that still add up to 3h 43m. `--estimate-step-minutes N` changes the step.
The rounding can never push a task past the cap below, because a capped task holds
at most a whole number of steps.

A task holds at most **8 hours**. Anything above that is split into
`title (1/n)`, `title (2/n)`, packing whole entries where possible and slicing a
single entry only when it exceeds the cap by itself. Change the cap with
`--max-task-hours N`.

Descriptions are compared with whitespace collapsed and trailing punctuation
removed, and case matters unless `--case-insensitive` is passed. Similar titles
are never merged automatically: creating the wrong issue is worse than creating
two.

## Output contract

With `--json`, stdout carries exactly one JSON document and nothing else. Every
warning, progress line and error goes to stderr. Durations arrive preformatted
(`timeSpent`, `totalHuman`) and `startedJira` is already in the shape Jira wants,
`yyyy-MM-dd'T'HH:mm:ss.SSSZ` with the offset written without a colon. Nothing
downstream should do date arithmetic.

`totalSeconds` is the source of truth; the decimal hours are for reading.

Exit codes: `0` ok, `1` unexpected, `2` usage, `3` no token, `4` auth rejected,
`5` rate limited, `6` network, **`7` partial write**, **`8` hourly quota
exhausted**, **`9` conflict** (a timer is already running, or `stop
--require-running` found none).

There are two separate Toggl limits. The leaky bucket returns `429` at roughly one
request per second and is worth retrying, which the client does. The **hourly
quota** on the free plan returns `402` with the reset window in the body; retrying
cannot help, so it fails fast with the wait in minutes. Because of that quota,
`/me` and the project catalog are cached and `--offline` runs off the cache alone
rather than spending a call.

A quota error is safe by construction: it is raised before anything is written.
But it matters for the Jira flow — if the quota runs out **between** creating the
worklogs in Jira and retagging in Toggl, the entries stay `pending` and a re-run
would duplicate the worklogs. Check the quota has room before starting a write
run.

## Writing tags

`toggl tag` is the only destructive command and it is a **dry run unless you pass
`--apply`**.

It computes the resulting tag set per entry and sends `op: "replace"` with the
full array, grouped so that entries with different extra tags never share a
request. `op: "remove"` is avoided on purpose: it has a long-standing bug in
Toggl's bulk edit, and RFC 6902 defines it over an index rather than a value.
Batches are capped at 100 ids.

A `200` does not mean success: the response carries a `failure[]` array and the
patch is applied partially, with no rollback. After writing, the CLI reads the
entries back and compares, which is what catches a silent no-op. Every attempt is
appended to `~/.local/state/toggl-track-cli/tag-journal.ndjson` before and after
the request.

## Order of operations, and why

In Jira: create the issue, set the estimate, add the worklogs, transition. Then,
and only then, retag in Toggl.

The tag is the commit point. If it flipped first and a later step failed, the
hours would silently never be registered. With this order the worst case is a
duplicated worklog, which is visible. That matters because **the Jira connector
cannot delete worklogs** — only create and update them.

## Endpoint selection

`/me/time_entries` for explicit ranges of 31 days or less: one request, and it is
filtered client-side by tag. Reports v3 for anything longer, and for a tag filter
without an explicit range, because it filters `tag_ids` server-side and paginates.

The 1000-entry cap of `/me/time_entries` applies *before* any filtering, so a wide
`--pending` scan has to go through Reports or it would silently return a subset.

Dates are widened by a day on each side before querying and then filtered by local
day, because a bare `end_date` is read as `00:00:00` in an undocumented zone.
Removing that widening loses the last day with no visible error.

## Configuration

`~/.config/toggl-track-cli/config.json`, mode `0600`, outside the repository so
that project names and Jira keys are never committed. It holds the workspace, the
timezone, the Jira site and the Toggl-project-to-Jira-project mapping, keyed by
Toggl project id rather than name, since names get renamed and ids do not.

The catalog of projects, clients and tags is cached for 24 hours in
`~/.cache/toggl-track-cli/`; `--no-cache` refreshes it.

## The skill

`skill/SKILL.md` is installed by symlinking it into the Claude Code skills
directory:

```sh
ln -sfn "$PWD/skill" ~/.claude/skills/toggl-jira
```

It is versioned here because the procedure depends on the CLI flags: when a flag
changes, both change in the same commit.

## Development

```sh
pnpm typecheck
pnpm test
```

Rate limiting is a leaky bucket at roughly one request per second, so the client
serialises requests 1.1s apart and backs off on 429 and 5xx.

Tests inject a fake clock and a fake `fetch`, so nothing touches the network, the
keychain or the wall clock. That is why `throttle` and `retry` take `now` and
`sleep`: the one-second spacing and the backoff are asserted, not assumed.
