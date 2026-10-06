import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { checkState, diffPr, nextDelay, parseGh } from '../hooks/watch'

const pr = (patch: Partial<Pr> = {}): Pr => ({
  number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'none', comments: 0, checks: [], ...patch,
})

test('backoff schedule', async () => {
  expect([0, 1, 2, 3, 9].map(nextDelay)).toEqual([60_000, 60_000, 120_000, 300_000, 300_000])
})

test('check states from check runs and status contexts', async () => {
  expect(checkState({ status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe('pass')
  expect(checkState({ status: 'COMPLETED', conclusion: 'SKIPPED' })).toBe('pass')
  expect(checkState({ status: 'COMPLETED', conclusion: 'FAILURE' })).toBe('fail')
  expect(checkState({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('fail')
  expect(checkState({ status: 'IN_PROGRESS', conclusion: '' })).toBe('running')
  expect(checkState({ status: 'QUEUED' })).toBe('queued')
  expect(checkState({ state: 'SUCCESS' })).toBe('pass')
  expect(checkState({ state: 'ERROR' })).toBe('fail')
  expect(checkState({ state: 'PENDING' })).toBe('running')
})

test('parseGh maps gh JSON', async () => {
  const out = JSON.stringify({
    number: 128, url: 'https://github.com/acme/web/pull/128', state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }, { context: 'ci/e2e', state: 'PENDING' }],
    comments: [{}, {}],
  })
  expect(parseGh(out)).toEqual(pr({ review: 'changes', comments: 2, checks: [{ name: 'lint', state: 'pass' }, { name: 'ci/e2e', state: 'running' }] }))
  expect(parseGh(JSON.stringify({ number: 128, url: 'https://x/1', state: 'MERGED', isDraft: false, reviewDecision: null, statusCheckRollup: null, comments: [] }))?.state).toBe('merged')
})

test('parseGh rejects garbage', async () => {
  expect(parseGh('')).toBe(null)
  expect(parseGh('not json')).toBe(null)
  expect(parseGh('{"number": 128}')).toBe(null)
  expect(parseGh('[1,2]')).toBe(null)
})

test('diffPr reports each change once', async () => {
  const before = pr({ checks: [{ name: 'e2e', state: 'running' }] })
  expect(diffPr(before, before)).toEqual([])
  expect(diffPr(before, pr({ checks: [{ name: 'e2e', state: 'fail' }] }))).toEqual([{ text: 'PR #128: CI failed on e2e', alert: 'e2e failed' }])
  expect(diffPr(before, pr({ checks: [{ name: 'e2e', state: 'pass' }] }))).toEqual([{ text: 'PR #128: all checks passed' }])
  expect(diffPr(before, pr({ checks: before.checks, review: 'approved' }))).toEqual([{ text: 'PR #128 was approved' }])
  expect(diffPr(before, pr({ checks: before.checks, review: 'changes' }))).toEqual([{ text: 'PR #128: changes requested', alert: 'changes requested' }])
  expect(diffPr(before, pr({ checks: before.checks, comments: 2 }))).toEqual([{ text: 'PR #128: 2 new comments', alert: 'new comment' }])
  expect(diffPr(before, pr({ checks: before.checks, state: 'merged' }))).toEqual([{ text: 'PR #128 was merged' }])
  expect(diffPr(before, pr({ checks: before.checks, state: 'closed' }))).toEqual([{ text: 'PR #128 was closed without merging', alert: 'PR closed' }])
})

test('parseGh ignores malformed check entries', async () => {
  const out = JSON.stringify({ number: 128, url: 'https://x/1', state: 'OPEN', isDraft: false, reviewDecision: null, comments: [], statusCheckRollup: [null, 3, { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] })
  expect(parseGh(out)?.checks).toEqual([{ name: 'lint', state: 'pass' }])
})
