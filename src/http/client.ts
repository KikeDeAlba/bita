import {
  TogglAuthError,
  TogglBadRequestError,
  TogglError,
  TogglNetworkError,
  TogglNotFoundError,
  TogglRateLimitError,
  TogglServerError,
  TogglQuotaError,
  TogglWorkspaceAccessError,
  isAuthFailureBody,
  parseQuotaResetSeconds,
} from './errors.ts'
import { createThrottle, type Throttle } from './throttle.ts'
import { parseRetryAfter, withRetry } from './retry.ts'
import {
  API_BASE_URL,
  MAX_RETRIES,
  MIN_REQUEST_INTERVAL_MS,
  REPORTS_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from '../config/constants.ts'

export type ApiBase = 'v9' | 'reports'

export type QueryValue = string | number | boolean | undefined | null

export interface TogglResponse<T> {
  data: T
  headers: Headers
  status: number
}

export interface RequestOptions {
  base?: ApiBase
  query?: Record<string, QueryValue>
  signal?: AbortSignal
}

export interface TogglClientOptions {
  token: string
  baseUrl?: string
  reportsBaseUrl?: string
  timeoutMs?: number
  minRequestIntervalMs?: number
  retries?: number
  userAgent?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onRequest?: (info: { method: string; url: string }) => void
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
}

const MAX_ERROR_BODY_LENGTH = 2048

function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${base}${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

export class TogglClient {
  private readonly authHeader: string
  private readonly baseUrl: string
  private readonly reportsBaseUrl: string
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly userAgent: string
  private readonly fetchImpl: typeof fetch
  private readonly throttle: Throttle
  private readonly sleep: ((ms: number) => Promise<void>) | undefined
  private readonly now: () => number
  private readonly onRequest: ((info: { method: string; url: string }) => void) | undefined
  private readonly onRetry:
    | ((info: { attempt: number; delayMs: number; error: unknown }) => void)
    | undefined

  constructor(options: TogglClientOptions) {
    this.authHeader = `Basic ${Buffer.from(`${options.token}:api_token`).toString('base64')}`
    this.baseUrl = options.baseUrl ?? API_BASE_URL
    this.reportsBaseUrl = options.reportsBaseUrl ?? REPORTS_BASE_URL
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.retries = options.retries ?? MAX_RETRIES
    this.userAgent = options.userAgent ?? 'toggl-track-cli/0.1.0'
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.sleep = options.sleep
    this.now = options.now ?? Date.now
    this.onRequest = options.onRequest
    this.onRetry = options.onRetry

    const throttleOptions: { now: () => number; sleep?: (ms: number) => Promise<void> } = {
      now: this.now,
    }
    if (options.sleep) throttleOptions.sleep = options.sleep
    this.throttle = createThrottle(
      options.minRequestIntervalMs ?? MIN_REQUEST_INTERVAL_MS,
      throttleOptions,
    )
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<TogglResponse<T>> {
    return this.request<T>('GET', path, undefined, options)
  }

  post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<TogglResponse<T>> {
    return this.request<T>('POST', path, body, options)
  }

  put<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<TogglResponse<T>> {
    return this.request<T>('PUT', path, body, options)
  }

  patch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<TogglResponse<T>> {
    return this.request<T>('PATCH', path, body, options)
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<TogglResponse<T>> {
    const base = options.base === 'reports' ? this.reportsBaseUrl : this.baseUrl
    const url = buildUrl(base, path, options.query)

    const retryOptions: Parameters<typeof withRetry>[1] = { retries: this.retries }
    if (this.sleep) retryOptions.sleep = this.sleep
    if (this.onRetry) retryOptions.onRetry = this.onRetry

    return withRetry(
      () => this.throttle(() => this.performFetch<T>(method, url, body, options.signal)),
      retryOptions,
    )
  }

  private async performFetch<T>(
    method: string,
    url: string,
    body: unknown,
    callerSignal: AbortSignal | undefined,
  ): Promise<TogglResponse<T>> {
    this.onRequest?.({ method, url })

    const signals = [AbortSignal.timeout(this.timeoutMs)]
    if (callerSignal) signals.push(callerSignal)

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    }

    const init: RequestInit = { method, headers, signal: AbortSignal.any(signals) }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new TogglNetworkError(`Request to ${url} failed: ${reason}`, {
        url,
        method,
        code: 'NETWORK_ERROR',
      })
    }

    if (!response.ok) throw await this.toError(response, method, url)

    const text = await response.text()
    const data = (text.length === 0 ? null : JSON.parse(text)) as T
    return { data, headers: response.headers, status: response.status }
  }

  private async toError(response: Response, method: string, url: string): Promise<TogglError> {
    const rawBody = await response.text().catch(() => '')
    const body = rawBody.slice(0, MAX_ERROR_BODY_LENGTH)
    const status = response.status
    const context = { url, method, status, body, code: 'HTTP_ERROR' }

    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.now())
      return new TogglRateLimitError(
        'Toggl rate limit reached. The safe rate is about 1 request per second.',
        { ...context, code: 'RATE_LIMITED' },
        retryAfterMs,
      )
    }

    if (status === 402) {
      const resetSeconds = parseQuotaResetSeconds(body)
      const wait =
        resetSeconds === undefined
          ? 'Wait for the quota window to roll over'
          : `Wait about ${Math.ceil(resetSeconds / 60)} minutes`
      return new TogglQuotaError(
        `Toggl hourly API quota exhausted on this plan. ${wait} and run the command again. Nothing was written.`,
        { ...context, code: 'QUOTA_EXHAUSTED' },
        resetSeconds,
      )
    }

    if (status === 401 || status === 403) {
      if (isAuthFailureBody(body)) {
        return new TogglAuthError(
          'Toggl rejected the API token. Run "toggl auth login" to store a valid one, or check TOGGL_API_TOKEN.',
          { ...context, code: 'AUTH_FAILED' },
        )
      }
      return new TogglWorkspaceAccessError(
        `Toggl denied access to ${url}. The token is valid but lacks access to this workspace.`,
        { ...context, code: 'WORKSPACE_FORBIDDEN' },
      )
    }

    if (status === 404) {
      return new TogglNotFoundError(`Not found: ${url}`, { ...context, code: 'NOT_FOUND' })
    }

    if (status >= 500) {
      return new TogglServerError(`Toggl server error ${status} for ${url}`, {
        ...context,
        code: 'SERVER_ERROR',
      })
    }

    return new TogglBadRequestError(`Toggl rejected the request (${status}): ${body}`, {
      ...context,
      code: 'BAD_REQUEST',
    })
  }
}
