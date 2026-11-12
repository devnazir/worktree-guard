import { test, expect } from 'claude-code/testing'
import { parseBranches, isProtected } from './register.ts'

test('defaults to main and master', async () => {
  expect(parseBranches(undefined)).toEqual(['main', 'master'])
})

test('parses a comma list, trimming blanks', async () => {
  expect(parseBranches(' main, develop ,, release/* ')).toEqual(['main', 'develop', 'release/*'])
})

test('matches exact names and prefix wildcards', async () => {
  const p = ['main', 'release/*']
  expect(isProtected('main', p)).toBe(true)
  expect(isProtected('release/1.2', p)).toBe(true)
  expect(isProtected('maintenance', p)).toBe(false)
  expect(isProtected('feature/pdp', p)).toBe(false)
})
