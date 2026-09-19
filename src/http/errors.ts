export interface TogglErrorContext {
  url: string
  method: string
  status?: number
  body?: string
  code: string
}

export class TogglError extends Error {
  readonly code: string
  readonly status: number | undefined
  readonly url: string
  readonly method: string
  readonly body: string | undefined

  constructor(message: string, context: TogglErrorContext) {
    super(message)
    this.name = new.target.name
    this.code = context.code
    this.status = context.status
    this.url = context.url
    this.method = context.method
    this.body = context.body
  }
}

export class TogglAuthError extends TogglError {}
export class TogglWorkspaceAccessError extends TogglError {}
export class TogglNotFoundError extends TogglError {}
export class TogglBadRequestError extends TogglError {}
export class TogglServerError extends TogglError {}
export class TogglNetworkError extends TogglError {}

export class TogglQuotaError extends TogglError {
  readonly resetSeconds: number | undefined

  constructor(message: string, context: TogglErrorContext, resetSeconds?: number) {
    super(message, context)
    this.resetSeconds = resetSeconds
  }
}

export class TogglRateLimitError extends TogglError {
  readonly retryAfterMs: number | undefined

  constructor(message: string, context: TogglErrorContext, retryAfterMs?: number) {
    super(message, context)
    this.retryAfterMs = retryAfterMs
  }
}

export class MissingTokenError extends Error {
  readonly code = 'MISSING_TOKEN'
  readonly hint: string

  constructor(message: string, hint: string) {
    super(message)
    this.name = 'MissingTokenError'
    this.hint = hint
  }
}

export class KeychainError extends Error {
  readonly code = 'KEYCHAIN_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'KeychainError'
  }
}

export class ConflictError extends Error {
  readonly code: string
  readonly hint: string | undefined

  constructor(message: string, code: string, hint?: string) {
    super(message)
    this.name = 'ConflictError'
    this.code = code
    this.hint = hint
  }
}

export class UsageError extends Error {
  readonly code = 'USAGE_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export class PartialWriteError extends Error {
  readonly code = 'PARTIAL_TAG_FAILURE'

  constructor(message: string) {
    super(message)
    this.name = 'PartialWriteError'
  }
}

const AUTH_BODY_MARKERS = ['incorrect username', 'invalid api token', 'authentication']

export function parseQuotaResetSeconds(body: string | undefined): number | undefined {
  const match = body?.match(/reset in (\d+) seconds/i)
  if (!match?.[1]) return undefined
  return Number(match[1])
}

export function isAuthFailureBody(body: string | undefined): boolean {
  if (!body) return true
  const lowered = body.toLowerCase()
  return AUTH_BODY_MARKERS.some((marker) => lowered.includes(marker))
}
