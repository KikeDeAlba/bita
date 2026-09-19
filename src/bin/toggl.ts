#!/usr/bin/env node
import { route } from '../cli/router.ts'
import {
  KeychainError,
  MissingTokenError,
  PartialWriteError,
  TogglAuthError,
  TogglNetworkError,
  TogglQuotaError,
  TogglRateLimitError,
  TogglWorkspaceAccessError,
  UsageError,
} from '../http/errors.ts'
import {
  EXIT_AUTH,
  EXIT_GENERIC,
  EXIT_MISSING_TOKEN,
  EXIT_NETWORK,
  EXIT_PARTIAL_WRITE,
  EXIT_QUOTA,
  EXIT_RATE_LIMITED,
  EXIT_USAGE,
} from '../cli/exit-codes.ts'
import { errorEnvelope, writeErr, writeJson } from '../cli/output.ts'

function exitCodeFor(error: unknown): number {
  if (error instanceof UsageError) return EXIT_USAGE
  if (error instanceof MissingTokenError) return EXIT_MISSING_TOKEN
  if (error instanceof TogglAuthError) return EXIT_AUTH
  if (error instanceof TogglWorkspaceAccessError) return EXIT_AUTH
  if (error instanceof TogglQuotaError) return EXIT_QUOTA
  if (error instanceof TogglRateLimitError) return EXIT_RATE_LIMITED
  if (error instanceof TogglNetworkError) return EXIT_NETWORK
  if (error instanceof PartialWriteError) return EXIT_PARTIAL_WRITE
  if (error instanceof KeychainError) return EXIT_GENERIC
  return EXIT_GENERIC
}

function codeFor(error: unknown): string {
  if (error instanceof UsageError) return 'USAGE_ERROR'
  if (error instanceof MissingTokenError) return 'MISSING_TOKEN'
  if (error instanceof PartialWriteError) return 'PARTIAL_TAG_FAILURE'
  if (error instanceof KeychainError) return 'KEYCHAIN_ERROR'
  const candidate = (error as { code?: unknown }).code
  return typeof candidate === 'string' ? candidate : 'UNEXPECTED_ERROR'
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const wantsJson = argv.includes('--json')

  try {
    process.exitCode = await route(argv)
  } catch (error) {
    if (error instanceof PartialWriteError) {
      process.exitCode = EXIT_PARTIAL_WRITE
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    const hint = error instanceof MissingTokenError ? error.hint : undefined

    if (wantsJson) {
      writeJson(
        errorEnvelope('error', {
          code: codeFor(error),
          message,
          ...(hint ? { hint } : {}),
        }),
      )
    } else {
      writeErr(message)
      if (hint) writeErr(`\n${hint}`)
    }

    process.exitCode = exitCodeFor(error)
  }
}

await main()
