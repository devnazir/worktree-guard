import type { Register, EngineInterface } from 'claude-code'

const DEFAULT_BRANCHES = 'main,master'

export const parseBranches = (raw: unknown): string[] =>
  String(raw ?? DEFAULT_BRANCHES)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

export const isProtected = (branch: string, patterns: readonly string[]): boolean =>
  patterns.some(p =>
    p.endsWith('*') ? branch.startsWith(p.slice(0, -1)) : branch === p,
  )

const parentOf = (path: string): string | undefined => {
  const trimmed = path.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i <= 0) return undefined
  const parent = trimmed.slice(0, i)
  // "C:" alone is not a usable dir; keep the separator.
  return /^[A-Za-z]:$/.test(parent) ? parent + '/' : parent
}

// The nearest existing directory holding `path` (a new file's folder may not exist yet).
const existingDir = async ($: EngineInterface, path: string): Promise<string | undefined> => {
  let dir = parentOf(path)
  for (let i = 0; dir && i < 64; i++) {
    try {
      const s = await $.fs.stat(dir)
      if (s.kind === 'dir') return dir
    } catch {
      // missing: keep walking up
    }
    dir = parentOf(dir)
  }
  return undefined
}

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function guard(
  $: EngineInterface,
  patterns: readonly string[],
  path: string | undefined,
): Promise<string | undefined> {
  if (!path || patterns.length === 0) return undefined
  const dir = await existingDir($, path)
  if (!dir) return undefined

  const branch = await git($, dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  // Not a git repo, or detached HEAD: nothing to protect.
  if (!branch || !isProtected(branch, patterns)) return undefined

  const top = (await git($, dir, ['rev-parse', '--show-toplevel'])) ?? dir
  const name = top.split(/[\\/]/).pop() || 'repo'
  return [
    `worktree-guard: "${branch}" is a protected branch (${patterns.join(', ')}), so edits to ${path} are blocked.`,
    `Do this work in a git worktree on its own branch instead, e.g.:`,
    `  git -C "${top}" worktree add "../${name}-<task>" -b feature/<task>`,
    `then edit files under that new folder (or use the EnterWorktree tool if available).`,
    `Ask the user before changing this rule; it is set in /config under worktree-guard.`,
  ].join('\n')
}

export const register: Register = (on, options) => {
  const patterns = parseBranches(options.protectedBranches)

  const deny = { deny: 'worktree-guard: the branch check failed, so the edit was blocked to be safe.' }

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const reason = await guard($, patterns, e.file_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : deny))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const reason = await guard($, patterns, e.file_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : deny))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const reason = await guard($, patterns, e.notebook_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : deny))
}
