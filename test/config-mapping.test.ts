import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  readConfig,
  setProjectMapping,
  setRepoMapping,
  unsetProjectMapping,
  unsetRepoMapping,
} from '../src/state/config.ts'

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

test('remembers which toggl project a repository belongs to', async () => {
  const configPath = await tempConfigPath()

  await setRepoMapping(
    'personal/toggl-track-cli',
    { togglProjectId: 222494997, togglProjectName: 'Pharma STI', slugSource: 'path' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.repoMapping['personal/toggl-track-cli']?.togglProjectId, 222494997)
  assert.equal(config.repoMapping['personal/toggl-track-cli']?.slugSource, 'path')
})

test('keeps the repo mapping when another command rewrites the config', async () => {
  const configPath = await tempConfigPath()

  await setRepoMapping(
    'git.solemti.net/innovacion/budget',
    { togglProjectId: 1, togglProjectName: 'Innovacion', slugSource: 'remote' },
    configPath,
  )
  await setProjectMapping(
    99,
    { togglProjectName: 'Otro', jiraProjectKey: 'INN' },
    configPath,
  )

  const config = await readConfig(configPath)

  assert.equal(config.repoMapping['git.solemti.net/innovacion/budget']?.togglProjectId, 1)
  assert.equal(config.projectMapping['99']?.jiraProjectKey, 'INN')
})

test('unsetting one repository leaves the others alone', async () => {
  const configPath = await tempConfigPath()

  await setRepoMapping('a/one', { togglProjectId: 1, togglProjectName: 'One', slugSource: 'path' }, configPath)
  await setRepoMapping('a/two', { togglProjectId: 2, togglProjectName: 'Two', slugSource: 'path' }, configPath)

  assert.equal(await unsetRepoMapping('a/one', configPath), true)
  assert.equal(await unsetRepoMapping('a/nope', configPath), false)

  const config = await readConfig(configPath)

  assert.equal(config.repoMapping['a/one'], undefined)
  assert.equal(config.repoMapping['a/two']?.togglProjectId, 2)
})
