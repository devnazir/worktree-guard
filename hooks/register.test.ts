import { test, expect } from 'claude-code/testing'
import { parseBranches, parseList, isProtected, planShell, isAllowedWork } from './register.ts'

test('defaults to main and master', async () => {
  expect(parseBranches(undefined)).toEqual(['main', 'master'])
})

test('parses a comma list, trimming blanks', async () => {
  expect(parseBranches(' main, develop ,, release/* ')).toEqual(['main', 'develop', 'release/*'])
  expect(parseList('git  worktree, git fetch', '')).toEqual(['git worktree', 'git fetch'])
})

test('matches exact names and prefix wildcards', async () => {
  const p = ['main', 'release/*']
  expect(isProtected('main', p)).toBe(true)
  expect(isProtected('release/1.2', p)).toBe(true)
  expect(isProtected('maintenance', p)).toBe(false)
  expect(isProtected('feature/pdp', p)).toBe(false)
})

test('a plain command runs in the session cwd', async () => {
  expect(planShell('git commit -m x')).toEqual({ dirs: [undefined], work: ['git commit -m x'] })
})

test('a leading cd replaces the session cwd', async () => {
  expect(planShell('cd "../repo-task" && npm install')).toEqual({ dirs: ['../repo-task'], work: ['npm install'] })
  expect(planShell('Set-Location C:\\x; rm a')).toEqual({ dirs: ['C:\\x'], work: ['rm a'] })
})

test('a later cd and git -C add directories', async () => {
  const p = planShell('ls && cd /a && git -C "/b c" commit -m x')
  expect(p.dirs).toEqual([undefined, '/a', '/b c'])
  expect(p.work).toEqual(['ls', 'git commit -m x'])
})

test('allowed prefixes match whole words only', async () => {
  const a = ['git worktree', 'git fetch']
  expect(isAllowedWork('git worktree add ../x -b f', a)).toBe(true)
  expect(isAllowedWork('git fetch', a)).toBe(true)
  expect(isAllowedWork('git fetcher', a)).toBe(false)
  expect(isAllowedWork('git commit -m x', a)).toBe(false)
})
