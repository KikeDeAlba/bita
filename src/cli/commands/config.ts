import { UsageError } from '../../errors.ts'
import { parseCommandArgs, readBoolean, readString } from '../args.ts'
import { CONFIG_PATH, readConfig, writeConfig } from '../../state/config.ts'
import { successEnvelope, writeJson, writeOut } from '../output.ts'

export async function runConfig(argv: string[]): Promise<number> {
  const subcommand = argv[0] ?? 'get'
  const args = parseCommandArgs(argv.slice(1), {
    'cloud-id': { type: 'string' },
    site: { type: 'string' },
    'account-id': { type: 'string' },
    'issue-type': { type: 'string' },
  })

  if (subcommand === 'get') {
    const config = await readConfig()
    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('config get', config, { path: CONFIG_PATH }))
      return 0
    }
    writeOut(`Path        : ${CONFIG_PATH}`)
    writeOut(`Jira site   : ${config.jira?.siteUrl ?? '(not set)'}`)
    writeOut(`Jira cloudId: ${config.jira?.cloudId ?? '(not set)'}`)
    writeOut(`Jira account: ${config.jira?.accountId ?? '(not set)'}`)
    writeOut(`Issue type  : ${config.defaults?.issueTypeName ?? '(not set)'}`)
    writeOut(`Mapped projects: ${Object.keys(config.projectMapping).length}`)
    return 0
  }

  if (subcommand === 'set-jira') {
    const cloudId = readString(args, 'cloud-id')
    const site = readString(args, 'site')
    const accountId = readString(args, 'account-id')
    const issueType = readString(args, 'issue-type')

    if (!cloudId && !site && !accountId && !issueType) {
      throw new UsageError(
        'Usage: toggl config set-jira [--cloud-id ID] [--site URL] [--account-id ID] [--issue-type NAME]',
      )
    }

    const config = await readConfig()
    config.jira = {
      ...config.jira,
      ...(cloudId !== undefined ? { cloudId } : {}),
      ...(site !== undefined ? { siteUrl: site } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
    }
    if (issueType !== undefined) {
      config.defaults = { ...config.defaults, issueTypeName: issueType }
    }
    await writeConfig(config)

    if (readBoolean(args, 'json')) {
      writeJson(successEnvelope('config set-jira', config.jira, { path: CONFIG_PATH }))
    } else {
      writeOut(`Saved Jira settings to ${CONFIG_PATH}.`)
    }
    return 0
  }

  throw new UsageError(`Unknown config subcommand "${subcommand}". Use get or set-jira.`)
}
