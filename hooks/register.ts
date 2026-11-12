import type { Register, EngineInterface } from 'claude-code'

const DEFAULT_BRANCHES = 'main,master'
const DEFAULT_ALLOWED = 'git worktree,git fetch'

export const parseList = (raw: unknown, fallback: string): string[] =>
  String(raw ?? fallback)
    .split(',')
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

export const parseBranches = (raw: unknown): string[] => parseList(raw, DEFAULT_BRANCHES)

export const isProtected = (branch: string, patterns: readonly string[]): boolean =>
  patterns.some(p =>
    p.endsWith('*') ? branch.startsWith(p.slice(0, -1)) : branch === p,
  )

const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, '$2')

// A command's segments, split on shell operators (best effort, quotes not tracked).
export const segments = (command: string): string[] =>
  command
    .split(/&&|\|\||;|\||\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)

const CD = /^(?:cd|pushd|chdir|Set-Location|sl|Push-Location)\s+(?:-(?:Literal)?Path\s+)?(.+)$/i
const GIT_C = /\bgit\s+-C\s+("[^"]*"|'[^']*'|\S+)/g

export type ShellPlan = {
  /** Directories the command works in; `undefined` stands for the session's cwd. */
  dirs: (string | undefined)[]
  /** The segments that do work (not a directory change), with `git -C <dir>` folded to `git`. */
  work: string[]
}

export const planShell = (command: string): ShellPlan => {
  const segs = segments(command)
  const dirs: (string | undefined)[] = []
  const work: string[] = []
  if (!segs[0] || !CD.test(segs[0])) dirs.push(undefined)
  for (const seg of segs) {
    const cd = CD.exec(seg)
    if (cd?.[1]) {
      dirs.push(unquote(cd[1]))
      continue
    }
    for (const m of seg.matchAll(GIT_C)) if (m[1]) dirs.push(unquote(m[1]))
    work.push(seg.replace(GIT_C, 'git').replace(/\s+/g, ' '))
  }
  return { dirs, work }
}

export const isAllowedWork = (seg: string, allowed: readonly string[]): boolean =>
  allowed.some(a => seg === a || seg.startsWith(a + ' '))

const parentOf = (path: string): string | undefined => {
  const trimmed = path.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i <= 0) return undefined
  const parent = trimmed.slice(0, i)
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
  try {
    const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout.trim() : undefined
  } catch {
    // cwd missing or git absent
    return undefined
  }
}

type Hit = { branch: string; top: string }

// The protected branch `dir` is on, if any.
async function protectedAt($: EngineInterface, patterns: readonly string[], dir: string): Promise<Hit | undefined> {
  const branch = await git($, dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  // Not a git repo, or detached HEAD: nothing to protect.
  if (!branch || !isProtected(branch, patterns)) return undefined
  const top = (await git($, dir, ['rev-parse', '--show-toplevel'])) ?? dir
  return { branch, top }
}

const howTo = (hit: Hit, patterns: readonly string[]): string => {
  const name = hit.top.split(/[\\/]/).pop() || 'repo'
  return [
    `"${hit.branch}" is a protected branch (${patterns.join(', ')}) in ${hit.top}.`,
    `Do this work in a git worktree on its own branch instead:`,
    `  git -C "${hit.top}" worktree add "../${name}-<task>" -b feature/<task>`,
    `then work under that folder (for shell commands, start with: cd "../${name}-<task>" && ...), or use the EnterWorktree tool if available.`,
    `Ask the user before changing this rule; it is set in /config under worktree-guard.`,
  ].join('\n')
}

async function guardFile($: EngineInterface, patterns: readonly string[], path: string | undefined): Promise<string | undefined> {
  if (!path || patterns.length === 0) return undefined
  const dir = await existingDir($, path)
  if (!dir) return undefined
  const hit = await protectedAt($, patterns, dir)
  return hit ? `worktree-guard: edits to ${path} are blocked.\n${howTo(hit, patterns)}` : undefined
}

async function guardShell(
  $: EngineInterface,
  patterns: readonly string[],
  allowed: readonly string[],
  command: string,
): Promise<string | undefined> {
  if (patterns.length === 0) return undefined
  const plan = planShell(command)
  if (plan.work.every(seg => isAllowedWork(seg, allowed))) return undefined
  const cwd = await $.session.cwd()
  for (const d of plan.dirs) {
    const hit = await protectedAt($, patterns, d ?? cwd)
    if (hit) {
      return [
        `worktree-guard: this command can change files or git state, and it runs on a protected branch, so it is blocked.`,
        howTo(hit, patterns),
        `Read-only commands and these prefixes stay allowed here: ${allowed.join(', ') || '(none)'}.`,
      ].join('\n')
    }
  }
  return undefined
}

const commandOf = (input: unknown): string | undefined => {
  const c = (input as { command?: unknown } | null)?.command
  return typeof c === 'string' ? c : undefined
}

export const register: Register = (on, options) => {
  const patterns = parseBranches(options.protectedBranches)
  const allowed = parseList(options.allowedCommands, DEFAULT_ALLOWED)

  const failed = 'worktree-guard: the branch check failed, so this was blocked to be safe.'

  // File tools.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const reason = await guardFile($, patterns, e.file_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: failed }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const reason = await guardFile($, patterns, e.file_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: failed }))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const reason = await guardFile($, patterns, e.notebook_path)
    return reason ? { deny: reason } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: failed }))

  // Shell tools: the engine marks commands it can prove read-only; everything else is checked.
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    if (e.isReadOnly) return next(e)
    const command = commandOf(e.input)
    const reason = command ? await guardShell($, patterns, allowed, command) : undefined
    return reason ? { decision: 'deny' as const, reason } : next(e)
  }).catch(() => ({ decision: 'deny' as const, reason: failed }))

  on('tool.check', { tool: 'PowerShell' }, async ($, e, next) => {
    if (e.isReadOnly) return next(e)
    const command = commandOf(e.input)
    const reason = command ? await guardShell($, patterns, allowed, command) : undefined
    return reason ? { decision: 'deny' as const, reason } : next(e)
  }).catch(() => ({ decision: 'deny' as const, reason: failed }))
}
