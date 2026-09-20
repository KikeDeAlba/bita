import { strict as assert } from 'node:assert'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DOCS_DIR_ENV_VAR, docsRoot, relativeDocPath, resolveDocPath } from '../src/docs/paths.ts'

test('the explicit override wins over everything else', () => {
  assert.equal(
    docsRoot({ [DOCS_DIR_ENV_VAR]: '/somewhere/docs', XDG_DATA_HOME: '/data' }, '/tmp/x/bita.db'),
    '/somewhere/docs',
  )
})

test('the documents follow the database they belong to', () => {
  assert.equal(docsRoot({}, '/tmp/x/bita.db'), '/tmp/x/docs')
})

test('an in-memory database falls back to the data home', () => {
  assert.equal(docsRoot({ XDG_DATA_HOME: '/data' }, ':memory:'), '/data/bita/docs')
})

test('without a database location it lands next to the default one', () => {
  assert.equal(docsRoot({ XDG_DATA_HOME: '/data' }), '/data/bita/docs')
  assert.equal(docsRoot({}), join(homedir(), '.local', 'share', 'bita', 'docs'))
})

test('refuses a path that climbs out of the root', () => {
  assert.throws(() => resolveDocPath('/docs', '../escape.md'), /escapes the docs root/)
  assert.throws(() => resolveDocPath('/docs', 'a/../../escape.md'), /escapes the docs root/)
})

test('refuses an absolute path and an empty one', () => {
  assert.throws(() => resolveDocPath('/docs', '/etc/passwd'), /must be relative/)
  assert.throws(() => resolveDocPath('/docs', ''), /cannot be empty/)
})

test('resolves a well formed relative path', () => {
  assert.equal(resolveDocPath('/docs', 'project/2026/09/20-1-thing.md'), '/docs/project/2026/09/20-1-thing.md')
})

test('turns an absolute path back into a relative one with forward slashes', () => {
  assert.equal(relativeDocPath('/docs', '/docs/project/2026/09/20-1-thing.md'), 'project/2026/09/20-1-thing.md')
  assert.throws(() => relativeDocPath('/docs', '/elsewhere/thing.md'), /not inside the docs root/)
})
