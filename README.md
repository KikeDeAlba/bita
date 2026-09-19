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
`5` rate limited, `6` network, **`7` partial write**.

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
