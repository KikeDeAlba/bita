import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTagPlan, desiredTagsFor } from '../src/domain/tag-plan.ts'
import { makeEntry } from './helpers/entries.ts'

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
