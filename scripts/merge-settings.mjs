import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const ALLOW = [
  'Bash(bita projects:*)',
  'Bash(bita project:*)',
  'Bash(bita entries:*)',
  'Bash(bita summary:*)',
  'Bash(bita ls:*)',
  'Bash(bita current:*)',
  'Bash(bita start:*)',
  'Bash(bita stop:*)',
  'Bash(bita log:*)',
  'Bash(bita link:*)',
  'Bash(bita note:*)',
  'Bash(bita repo:*)',
  'Bash(bita map list:*)',
  'Bash(bita map set:*)',
  'Bash(bita map unset:*)',
  'Bash(bita map story:*)',
  'Bash(bita config get:*)',
  'Bash(bita config set-jira:*)',
  'Bash(bita hook:*)',
  'Bash(bita --version)',
]

const ASK = ['Bash(bita cancel:*)']

const HOOK = {
  matcher: 'startup|resume|clear|compact',
  hooks: [{ type: 'command', command: 'bita hook session-start', timeout: 5 }],
}

const path = process.argv[2]

function printManualBlock() {
  console.log('  Add this to your settings.json by hand:')
  console.log(
    JSON.stringify({ permissions: { allow: ALLOW, ask: ASK }, hooks: { SessionStart: [HOOK] } }, null, 2)
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n'),
  )
}

if (!path || !existsSync(path)) {
  printManualBlock()
  process.exit(0)
}

let settings
try {
  settings = JSON.parse(readFileSync(path, 'utf8'))
} catch (error) {
  console.log(`  ! ${path} is not valid JSON, so it was left alone: ${String(error)}`)
  printManualBlock()
  process.exit(0)
}

copyFileSync(path, `${path}.backup`)

settings.permissions ??= {}
settings.permissions.allow ??= []
settings.permissions.ask ??= []

const addedAllow = ALLOW.filter((rule) => !settings.permissions.allow.includes(rule))
settings.permissions.allow.push(...addedAllow)

const addedAsk = ASK.filter((rule) => !settings.permissions.ask.includes(rule))
settings.permissions.ask.push(...addedAsk)

settings.hooks ??= {}
settings.hooks.SessionStart ??= []

const alreadyHooked = settings.hooks.SessionStart.some((entry) =>
  (entry.hooks ?? []).some((hook) => hook.command === HOOK.hooks[0].command),
)
if (!alreadyHooked) settings.hooks.SessionStart.push(HOOK)

writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`)

console.log(`  backed up to ${path}.backup`)
console.log(`  permissions: ${addedAllow.length} added to allow, ${addedAsk.length} to ask`)
console.log(`  SessionStart hook: ${alreadyHooked ? 'already there' : 'added'}`)
