import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { KeychainError } from '../errors.ts'
import { KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE, KEYCHAIN_SERVICE } from '../config/constants.ts'

const SECURITY_BIN = '/usr/bin/security'

export interface KeychainOptions {
  service?: string
  account?: string
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export type ExecRunner = (args: string[]) => Promise<ExecResult>
export type StdinRunner = (args: string[], input: string) => Promise<ExecResult>

export interface KeychainDeps {
  run?: ExecRunner
  runWithStdin?: StdinRunner
}

export function defaultAccount(): string {
  return process.env['USER'] ?? os.userInfo().username
}

function exitCodeOf(error: unknown): number {
  if (!error) return 0
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : 1
}

const runSecurity: ExecRunner = (args) =>
  new Promise((resolve) => {
    execFile(SECURITY_BIN, args, (error, stdout, stderr) => {
      resolve({ code: exitCodeOf(error), stdout, stderr })
    })
  })

const runSecurityWithStdin: StdinRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(SECURITY_BIN, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr })
    })
    child.stdin.write(input)
    child.stdin.end()
  })

function quoteForSecurity(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function readKeychainToken(
  options: KeychainOptions = {},
  deps: KeychainDeps = {},
): Promise<string | null> {
  const service = options.service ?? KEYCHAIN_SERVICE
  const account = options.account ?? defaultAccount()
  const run = deps.run ?? runSecurity

  const result = await run(['find-generic-password', '-s', service, '-a', account, '-w'])

  if (result.code === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) return null
  if (result.code !== 0) {
    throw new KeychainError(
      `Could not read the token from the macOS keychain (exit ${result.code}). ${result.stderr.trim()}`,
    )
  }

  const token = result.stdout.trim()
  return token.length > 0 ? token : null
}

export async function writeKeychainToken(
  token: string,
  options: KeychainOptions = {},
  deps: KeychainDeps = {},
): Promise<void> {
  const service = options.service ?? KEYCHAIN_SERVICE
  const account = options.account ?? defaultAccount()
  const runWithStdin = deps.runWithStdin ?? runSecurityWithStdin

  const command = [
    'add-generic-password',
    '-s',
    quoteForSecurity(service),
    '-a',
    quoteForSecurity(account),
    '-U',
    '-w',
    quoteForSecurity(token),
  ].join(' ')

  const result = await runWithStdin(['-i'], `${command}\n`)

  if (result.code !== 0) {
    throw new KeychainError(
      `Could not store the token in the macOS keychain (exit ${result.code}). ${result.stderr.trim()}`,
    )
  }
}

export async function deleteKeychainToken(
  options: KeychainOptions = {},
  deps: KeychainDeps = {},
): Promise<boolean> {
  const service = options.service ?? KEYCHAIN_SERVICE
  const account = options.account ?? defaultAccount()
  const run = deps.run ?? runSecurity

  const result = await run(['delete-generic-password', '-s', service, '-a', account])

  if (result.code === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) return false
  if (result.code !== 0) {
    throw new KeychainError(
      `Could not delete the token from the macOS keychain (exit ${result.code}). ${result.stderr.trim()}`,
    )
  }
  return true
}
