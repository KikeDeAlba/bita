import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTagPlan, desiredTagsFor } from '../src/domain/tag-plan.ts'
import { makeEntry } from './helpers/entries.ts'
import { canonicalizeTagNames, emptyCatalog, unknownTagNames } from '../src/toggl/catalog.ts'

const change = { add: ['registered'], remove: ['pending'] }

test('swaps the state tag', () => {
  assert.deepEqual(desiredTagsFor(['pending'], change), ['registered'])
})

test('preserves tags that the change does not mention', () => {
  assert.deepEqual(desiredTagsFor(['pending', 'urgent'], change), ['urgent', 'registered'])
})

test('is a no-op when the entry already has the desired tags', () => {
  const plan = buildTagPlan([makeEntry({ id: 1, tags: ['registered'] })], change, 456)

  assert.deepEqual(plan.unchanged, [1])
  assert.equal(plan.batches.length, 0)
  assert.equal(plan.requestCount, 0)
})

test('puts entries with the same resulting tag set in one batch', () => {
  const plan = buildTagPlan(
    [makeEntry({ id: 1 }), makeEntry({ id: 2 }), makeEntry({ id: 3 })],
    change,
    456,
  )

  assert.equal(plan.batches.length, 1)
  assert.deepEqual(plan.batches[0]?.ids, [1, 2, 3])
  assert.deepEqual(plan.batches[0]?.desiredTags, ['registered'])
})

test('separates entries whose extra tags would otherwise be wiped', () => {
  const plan = buildTagPlan(
    [makeEntry({ id: 1, tags: ['pending'] }), makeEntry({ id: 2, tags: ['pending', 'urgent'] })],
    change,
    456,
  )

  assert.equal(plan.batches.length, 2)
  const withExtra = plan.batches.find((batch) => batch.ids.includes(2))
  assert.deepEqual(withExtra?.desiredTags, ['urgent', 'registered'])
})

test('chunks the batches at a hundred ids', () => {
  const entries = Array.from({ length: 250 }, (_, index) => makeEntry({ id: index + 1 }))
  const plan = buildTagPlan(entries, change, 456)

  assert.equal(plan.batches.length, 3)
  assert.deepEqual(
    plan.batches.map((batch) => batch.ids.length),
    [100, 100, 50],
  )
})

test('matches tag names regardless of case', () => {
  const plan = buildTagPlan([makeEntry({ id: 1, tags: ['Pending'] })], change, 456)

  assert.deepEqual(plan.batches[0]?.desiredTags, ['registered'])
})

test('reuses the exact casing the workspace already has for a tag', () => {
  const catalog = emptyCatalog()
  for (const tag of [
    { id: 1, workspace_id: 456, name: 'Pending' },
    { id: 2, workspace_id: 456, name: 'Registered' },
  ]) {
    catalog.tagsById.set(tag.id, tag)
    catalog.tagsByName.set(tag.name.toLowerCase(), tag)
  }

  assert.deepEqual(canonicalizeTagNames(catalog, ['registered']), ['Registered'])
  assert.deepEqual(canonicalizeTagNames(catalog, ['pending']), ['Pending'])
})

test('leaves a genuinely new tag name untouched and reports it', () => {
  const catalog = emptyCatalog()

  assert.deepEqual(canonicalizeTagNames(catalog, ['brand-new']), ['brand-new'])
  assert.deepEqual(unknownTagNames(catalog, ['brand-new']), ['brand-new'])
})

test('does not invent a lowercase duplicate of an existing tag', () => {
  const catalog = emptyCatalog()
  const tag = { id: 2, workspace_id: 456, name: 'Registered' }
  catalog.tagsById.set(tag.id, tag)
  catalog.tagsByName.set('registered', tag)

  const canonical = canonicalizeTagNames(catalog, ['registered'])
  const plan = buildTagPlan(
    [makeEntry({ id: 1, tags: ['Pending'] })],
    { add: canonical, remove: canonicalizeTagNames(catalog, ['pending']) },
    456,
  )

  assert.deepEqual(plan.batches[0]?.desiredTags, ['Registered'])
  assert.deepEqual(unknownTagNames(catalog, canonical), [])
})
