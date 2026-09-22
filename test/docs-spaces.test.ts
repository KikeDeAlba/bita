import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { withPagedProjects, type SpaceProject } from '../src/cli/commands/docs.ts'

const measured: SpaceProject = {
  projectId: 1,
  projectName: 'Pharma STI',
  projectSlug: 'pharma-sti',
  active: true,
  entryCount: 12,
}

test('a space with pages but no measured time still shows up', () => {
  const spaces = withPagedProjects([measured], [1, 2], (id) =>
    id === 2 ? { name: 'Recomendador', active: true } : undefined,
  )

  assert.deepEqual(
    spaces.map((space) => [space.projectId, space.projectName, space.entryCount]),
    [
      [1, 'Pharma STI', 12],
      [2, 'Recomendador', 0],
    ],
  )
})

test('a project that already has documents is not listed twice', () => {
  assert.equal(withPagedProjects([measured], [1, 1], () => undefined).length, 1)
})

test('pages without a project land in their own space', () => {
  const spaces = withPagedProjects([], [null], () => undefined)

  assert.deepEqual(
    spaces.map((space) => [space.projectId, space.projectSlug]),
    [[null, '_no-project']],
  )
})
