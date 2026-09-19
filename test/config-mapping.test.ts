import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readConfig, setProjectMapping, unsetProjectMapping } from '../src/state/config.ts'

async function tempConfigPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'toggl-cfg-'))
  return path.join(dir, 'config.json')
}

test('keeps a separate epic for each toggl project inside the same jira project', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(
    222494997,
    { togglProjectName: 'Pharma STI', jiraProjectKey: 'INN', parentKey: 'INN-1213' },
    configPath,
  )
  await setProjectMapping(
    222440981,
    { togglProjectName: 'ARSM', jiraProjectKey: 'INN', parentKey: 'INN-1216' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['222494997']?.jiraProjectKey, 'INN')
  assert.equal(config.projectMapping['222440981']?.jiraProjectKey, 'INN')
  assert.equal(config.projectMapping['222494997']?.parentKey, 'INN-1213')
  assert.equal(config.projectMapping['222440981']?.parentKey, 'INN-1216')
})

test('a mapping without an epic stays without one', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(
    219665238,
    { togglProjectName: 'IA DP', jiraProjectKey: 'IADP' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['219665238']?.jiraProjectKey, 'IADP')
  assert.equal(config.projectMapping['219665238']?.parentKey, undefined)
})

test('overwriting a mapping replaces its epic', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { togglProjectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-1' }, configPath)
  await setProjectMapping(1, { togglProjectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-2' }, configPath)

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['1']?.parentKey, 'INN-2')
})

test('unsetting removes the mapping and leaves the others alone', async () => {
  const configPath = await tempConfigPath()

  await setProjectMapping(1, { togglProjectName: 'X', jiraProjectKey: 'INN', parentKey: 'INN-1' }, configPath)
  await setProjectMapping(2, { togglProjectName: 'Y', jiraProjectKey: 'INN', parentKey: 'INN-2' }, configPath)

  assert.equal(await unsetProjectMapping(1, configPath), true)
  assert.equal(await unsetProjectMapping(99, configPath), false)

  const config = await readConfig(configPath)

  assert.equal(config.projectMapping['1'], undefined)
  assert.equal(config.projectMapping['2']?.parentKey, 'INN-2')
})

test('the config file is written with owner-only permissions', async () => {
  const configPath = await tempConfigPath()
  await setProjectMapping(1, { togglProjectName: 'X', jiraProjectKey: 'INN' }, configPath)

  const raw = await readFile(configPath, 'utf8')

  assert.match(raw, /"jiraProjectKey": "INN"/)
})
