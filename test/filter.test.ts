import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesTagFilter, withinLocalRange } from '../src/domain/filter.ts'
import { makeEntry } from './helpers/entries.ts'

test('matches any of the requested tags by default', () => {
  const filter = { include: ['pending', 'urgent'], exclude: [], mode: 'any' as const }

  assert.equal(matchesTagFilter({ tags: ['pending'] }, filter), true)
  assert.equal(matchesTagFilter({ tags: ['other'] }, filter), false)
})

test('requires every tag in all mode', () => {
  const filter = { include: ['pending', 'urgent'], exclude: [], mode: 'all' as const }

  assert.equal(matchesTagFilter({ tags: ['pending'] }, filter), false)
  assert.equal(matchesTagFilter({ tags: ['pending', 'urgent'] }, filter), true)
})

test('excludes take precedence over includes', () => {
  const filter = { include: ['pending'], exclude: ['skip'], mode: 'any' as const }

  assert.equal(matchesTagFilter({ tags: ['pending', 'skip'] }, filter), false)
})

test('ignores case when comparing tag names', () => {
  const filter = { include: ['Pending'], exclude: [], mode: 'any' as const }

  assert.equal(matchesTagFilter({ tags: ['pending'] }, filter), true)
})

test('untagged mode only keeps entries with no tags at all', () => {
  const filter = { include: [], exclude: [], mode: 'any' as const, untaggedOnly: true }

  assert.equal(matchesTagFilter({ tags: [] }, filter), true)
  assert.equal(matchesTagFilter({ tags: ['pending'] }, filter), false)
})

test('drops the extra days that the widened query brought back', () => {
  const inside = makeEntry({ start: '2026-09-16T16:00:00Z' })
  const outside = makeEntry({ start: '2026-09-21T16:00:00Z' })

  assert.equal(withinLocalRange(inside, '2026-09-15', '2026-09-19'), true)
  assert.equal(withinLocalRange(outside, '2026-09-15', '2026-09-19'), false)
})
