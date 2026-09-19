import type { TogglClient } from '../http/client.ts'
import type { TagBatch, TagPlan } from '../domain/tag-plan.ts'
import type { WireBulkPatchResult, WireTimeEntry } from './wire-types.ts'
import { TogglBadRequestError, TogglNotFoundError } from '../http/errors.ts'

export type MutationStrategy = 'patch' | 'put'

export type FailureStage = 'request' | 'response' | 'verification'

export interface TagFailure {
  id: number
  message: string
  stage: FailureStage
  currentTags: string[]
  desiredTags: string[]
}

export interface TagApplyResult {
  updated: number[]
  unchanged: number[]
  failed: TagFailure[]
  strategy: MutationStrategy
  verified: boolean
}

function patchBody(desiredTags: string[]): Array<{ op: string; path: string; value: string[] }> {
  return [{ op: 'replace', path: '/tags', value: desiredTags }]
}

async function applyBatchWithPatch(
  client: TogglClient,
  workspaceId: number,
  batch: TagBatch,
): Promise<{ updated: number[]; failed: TagFailure[] }> {
  const path = `/workspaces/${workspaceId}/time_entries/${batch.ids.join(',')}`
  const response = await client.patch<WireBulkPatchResult | null>(path, patchBody(batch.desiredTags))
  const result = response.data ?? { success: [], failure: [] }

  const updated = result.success ?? []
  const failed: TagFailure[] = (result.failure ?? []).map((item) => ({
    id: item.id,
    message: item.message,
    stage: 'request' as const,
    currentTags: batch.currentTags,
    desiredTags: batch.desiredTags,
  }))

  const accounted = new Set([...updated, ...failed.map((item) => item.id)])
  for (const id of batch.ids) {
    if (!accounted.has(id)) {
      failed.push({
        id,
        message: 'Toggl did not report this entry as succeeded or failed.',
        stage: 'response',
        currentTags: batch.currentTags,
        desiredTags: batch.desiredTags,
      })
    }
  }

  return { updated, failed }
}

async function applyBatchWithPut(
  client: TogglClient,
  workspaceId: number,
  batch: TagBatch,
): Promise<{ updated: number[]; failed: TagFailure[] }> {
  const updated: number[] = []
  const failed: TagFailure[] = []

  const removed = batch.currentTags.filter(
    (tag) => !batch.desiredTags.some((desired) => desired.toLowerCase() === tag.toLowerCase()),
  )
  const added = batch.desiredTags.filter(
    (tag) => !batch.currentTags.some((current) => current.toLowerCase() === tag.toLowerCase()),
  )

  for (const id of batch.ids) {
    const path = `/workspaces/${workspaceId}/time_entries/${id}`
    try {
      if (removed.length > 0) {
        await client.put(path, { tag_action: 'delete', tags: removed })
      }
      if (added.length > 0) {
        await client.put(path, { tag_action: 'add', tags: added })
      }
      updated.push(id)
    } catch (error) {
      failed.push({
        id,
        message: error instanceof Error ? error.message : String(error),
        stage: 'request',
        currentTags: batch.currentTags,
        desiredTags: batch.desiredTags,
      })
    }
  }

  return { updated, failed }
}

export interface ApplyTagPlanOptions {
  strategy?: MutationStrategy
  verify?: boolean
  onBatch?: (batch: TagBatch, index: number, total: number) => void
  readEntries?: (ids: number[]) => Promise<WireTimeEntry[]>
}

export async function applyTagPlan(
  client: TogglClient,
  plan: TagPlan,
  options: ApplyTagPlanOptions = {},
): Promise<TagApplyResult> {
  const requested = options.strategy ?? 'patch'
  let strategy = requested
  const updated: number[] = []
  const failed: TagFailure[] = []

  for (const [index, batch] of plan.batches.entries()) {
    options.onBatch?.(batch, index + 1, plan.batches.length)

    if (strategy === 'patch') {
      try {
        const result = await applyBatchWithPatch(client, plan.workspaceId, batch)
        updated.push(...result.updated)
        failed.push(...result.failed)
        continue
      } catch (error) {
        if (!(error instanceof TogglBadRequestError || error instanceof TogglNotFoundError)) {
          throw error
        }
        strategy = 'put'
      }
    }

    const result = await applyBatchWithPut(client, plan.workspaceId, batch)
    updated.push(...result.updated)
    failed.push(...result.failed)
  }

  let verified = false

  if (options.verify !== false && options.readEntries && updated.length > 0) {
    const desiredById = new Map<number, TagBatch>()
    for (const batch of plan.batches) {
      for (const id of batch.ids) desiredById.set(id, batch)
    }

    const observed = await options.readEntries(updated)
    const observedById = new Map(observed.map((entry) => [entry.id, entry.tags ?? []]))
    verified = true

    for (let index = updated.length - 1; index >= 0; index -= 1) {
      const id = updated[index]
      if (id === undefined) continue
      const batch = desiredById.get(id)
      const actual = observedById.get(id)
      if (!batch || !actual) continue

      const expected = [...batch.desiredTags].map((tag) => tag.toLowerCase()).sort()
      const got = [...actual].map((tag) => tag.toLowerCase()).sort()
      const matches = expected.length === got.length && expected.every((tag, i) => tag === got[i])

      if (!matches) {
        updated.splice(index, 1)
        failed.push({
          id,
          message: `Toggl reported success but the tags are still [${actual.join(', ')}].`,
          stage: 'verification',
          currentTags: actual,
          desiredTags: batch.desiredTags,
        })
      }
    }
  }

  return { updated, unchanged: plan.unchanged, failed, strategy, verified }
}
