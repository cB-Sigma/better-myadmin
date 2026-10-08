export interface ConfigIssue {
  /** Dotted path of the offending directive, e.g. `Servers.2.port`. */
  path: string
  message: string
  /** Where the value came from: a file name, `env BMA__...`, or `defaults`. */
  source?: string
}

/** Thrown by the loader for unknown directives and invalid values; lists every problem at once. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[]

  constructor(issues: readonly ConfigIssue[], heading = 'Invalid BetterMyAdmin configuration') {
    super(`${heading}:\n${issues.map((i) => `  - ${formatIssue(i)}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export function formatIssue(issue: ConfigIssue): string {
  const where = issue.path === '' ? '' : `${issue.path}: `
  const src = issue.source ? ` (from ${issue.source})` : ''
  return `${where}${issue.message}${src}`
}
