import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { docRelPath } from '../src/docs/layout.ts'
import { NO_PROJECT_SLUG } from '../src/docs/slug.ts'
import { TEST_TZ } from './helpers/entries.ts'

const base = {
  entryId: 128,
  startedAt: '2026-09-20T16:04:11.000Z',
  timezone: TEST_TZ,
  projectName: 'Apartados',
  description: 'Ajustar el pipeline de despliegue',
}

test('mirrors the project and the day the work started', () => {
  assert.equal(docRelPath(base), 'apartados/2026/09/20-128-ajustar-el-pipeline-de-despliegue.md')
})

test('a late night start stays on its local day, not on the UTC one', () => {
  const lateNight = { ...base, entryId: 7, startedAt: '2026-09-21T05:30:00.000Z' }
  assert.equal(docRelPath(lateNight).startsWith('apartados/2026/09/20-7-'), true)
})

test('an entry without a project lands in its own folder', () => {
  assert.equal(
    docRelPath({ ...base, projectName: null }),
    `${NO_PROJECT_SLUG}/2026/09/20-128-ajustar-el-pipeline-de-despliegue.md`,
  )
})

test('a draft keeps a stable name until it earns a title', () => {
  assert.equal(docRelPath({ ...base, description: '' }), 'apartados/2026/09/20-128-draft.md')
})

test('two entries with the same title on the same day do not collide', () => {
  assert.notEqual(docRelPath(base), docRelPath({ ...base, entryId: 129 }))
})

test('an appendix sits beside its note', () => {
  assert.equal(
    docRelPath({ ...base, kind: 'appendix', suffix: 'Plan de despliegue' }),
    'apartados/2026/09/20-128-ajustar-el-pipeline-de-despliegue--plan-de-despliegue.md',
  )
})
