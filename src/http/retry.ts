import {
  TogglNetworkError,
  TogglRateLimitError,
  TogglServerError,
} from './errors.ts'
import { MAX_RETRIES, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from '../config/constants.ts'

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof TogglRateLimitError ||
    error instanceof TogglServerError ||
    error instanceof TogglNetworkError
  )
}

export async function withRetry<T>(attempt: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? MAX_RETRIES
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? RETRY_MAX_DELAY_MS
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  let lastError: unknown

  for (let tryIndex = 0; tryIndex <= retries; tryIndex += 1) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || tryIndex === retries) throw error

      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** tryIndex)
      const jittered = Math.floor(random() * exponential)
      const retryAfterMs =
        error instanceof TogglRateLimitError ? error.retryAfterMs : undefined
      const delayMs = retryAfterMs ?? jittered

      options.onRetry?.({ attempt: tryIndex + 1, delayMs, error })
      await sleep(delayMs)
    }
  }

  throw lastError
}

export function parseRetryAfter(headerValue: string | null, now: number): number | undefined {
  if (!headerValue) return undefined

  const asSeconds = Number(headerValue)
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000)

  const asDate = Date.parse(headerValue)
  if (Number.isFinite(asDate)) return Math.max(0, asDate - now)

  return undefined
}
