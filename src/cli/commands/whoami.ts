import { parseCommandArgs, readBoolean } from '../args.ts'
import { createContext } from '../context.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export async function runWhoami(argv: string[]): Promise<number> {
  const args = parseCommandArgs(argv, {})
  const ctx = await createContext(args)

  const payload = {
    userId: ctx.me.id,
    email: ctx.me.email,
    fullname: ctx.me.fullname,
    defaultWorkspaceId: ctx.me.default_workspace_id,
    workspaceId: ctx.workspaceId,
    workspaceName: ctx.catalog.workspaces.get(ctx.workspaceId)?.name ?? null,
    timezone: ctx.timezone,
    beginningOfWeek: ctx.me.beginning_of_week,
    tokenSource: ctx.token.source,
  }

  if (readBoolean(args, 'json')) {
    writeJson(successEnvelope('whoami', payload))
  } else {
    writeOut(`User      : ${payload.fullname} <${payload.email}>`)
    writeOut(`Workspace : ${payload.workspaceName ?? payload.workspaceId} (${payload.workspaceId})`)
    writeOut(`Timezone  : ${payload.timezone}`)
    writeOut(`Week starts on day ${payload.beginningOfWeek} (0 = Sunday)`)
    writeOut(`Token from: ${payload.tokenSource}`)
  }
  return 0
}
