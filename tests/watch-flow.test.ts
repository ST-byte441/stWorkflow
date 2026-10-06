import { expect, test } from 'claude-code/testing'

import { driveTo, runCommand, start, status, stubEngine } from './helpers'

const gh = (patch: Record<string, unknown>) => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify({
    number: 128, url: 'https://github.com/acme/web/pull/128', state: 'OPEN', isDraft: false, reviewDecision: '',
    statusCheckRollup: [{ name: 'e2e', status: 'IN_PROGRESS', conclusion: '' }], comments: [], ...patch,
  }),
})

test('polls after entering 14, alerts on changes, finishes on merge', async ($, on) => {
  const replies = [
    gh({}),
    gh({ statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
    gh({ state: 'MERGED', statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  ]
  const calls = stubEngine(on, () => replies.shift() ?? gh({ state: 'MERGED' }))
  await start($)
  await driveTo($, 14)

  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(1)
  expect(calls.gh[0]).toEqual(['gh', 'pr', 'view', '128', '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup,comments,reviews'])

  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.toasts).toContain('PR #128: CI failed on e2e')
  expect(calls.logs).toContain('⚑ PR #128: CI failed on e2e')
  expect(await status($)).toContain('Alert: e2e failed')

  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.toasts).toContain('PR #128 was merged')
  expect(calls.toasts).toContain('stWorkflow: run complete.')
  expect(await status($)).toContain('Step 15/15 · done')

  await calls.clock.advance(600_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(3)
})

test('backs off and warns once when GitHub is unreachable', async ($, on) => {
  const calls = stubEngine(on, () => ({ exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' }))
  await start($)
  await driveTo($, 14)
  for (const ms of [5_000, 60_000, 120_000]) {
    await calls.clock.advance(ms)
    await calls.clock.settle()
  }
  expect(calls.gh.length).toBe(3)
  expect(calls.toasts.filter(t => t.includes("can't reach GitHub"))).toEqual(["stWorkflow: can't reach GitHub: error connecting to api.github.com"])
  await calls.clock.advance(299_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(3)
  await calls.clock.advance(1_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(4)
  expect(calls.toasts.filter(t => t.includes("can't reach GitHub")).length).toBe(1)
})

test('garbage output counts as a failure', async ($, on) => {
  const calls = stubEngine(on, () => ({ exitCode: 0, stdout: '<html>rate limited</html>', stderr: '' }))
  await start($)
  await driveTo($, 14)
  for (const ms of [5_000, 60_000, 120_000]) {
    await calls.clock.advance(ms)
    await calls.clock.settle()
  }
  expect(calls.toasts).toContain("stWorkflow: can't reach GitHub: gh returned output stWorkflow could not read")
  expect(calls.logs.filter(l => l.startsWith('⚑ PR'))).toEqual([])
})

test('a second session.start does not double-poll', async ($, on) => {
  const calls = stubEngine(on, () => gh({}))
  await start($)
  await driveTo($, 14)
  await start($)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(1)
  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(2)
})

test('an abort during an in-flight poll is not undone', async ($, on) => {
  const calls = stubEngine(on, async () => {
    await calls.clock.sleep(10_000)
    return gh({ state: 'MERGED' })
  })
  await start($)
  await driveTo($, 14)
  await calls.clock.advance(5_000)
  expect(calls.gh.length).toBe(1)
  await runCommand($, 'stWorkflow-abort')
  await calls.clock.advance(10_000)
  await calls.clock.settle()
  expect(await status($)).toBe('No stWorkflow run is active.')
  expect(calls.toasts.filter(t => t.includes('⚑ PR') || t.includes('PR #'))).toEqual([])
  expect(calls.logs.filter(l => l.startsWith('⚑ PR'))).toEqual([])
})

test('the first poll after entering 14 sets the baseline without comment or review alerts', async ($, on) => {
  const three = [{ body: 'a' }, { body: 'b' }, { body: 'c' }]
  const replies = [
    gh({ comments: three, reviewDecision: 'APPROVED' }),
    gh({ comments: [...three, { body: 'd' }], reviewDecision: 'APPROVED' }),
  ]
  const calls = stubEngine(on, () => replies.shift() ?? gh({ comments: [...three, { body: 'd' }], reviewDecision: 'APPROVED' }))
  await start($)
  await driveTo($, 14)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(1)
  expect(calls.toasts.filter(t => t.startsWith('PR #'))).toEqual([])
  expect(await status($)).not.toContain('Alert:')

  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.toasts.filter(t => t.startsWith('PR #'))).toEqual(['PR #128: 1 new comment'])
})

test('the baseline poll still reports failing checks', async ($, on) => {
  const calls = stubEngine(on, () => gh({ comments: [{ body: 'a' }], statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] }))
  await start($)
  await driveTo($, 14)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.toasts.filter(t => t.startsWith('PR #'))).toEqual(['PR #128: CI failed on e2e'])
})

test('a reload into 14 sets a new baseline', async ($, on) => {
  const replies = [gh({}), gh({ comments: [{ body: 'a' }, { body: 'b' }] })]
  const calls = stubEngine(on, () => replies.shift() ?? gh({ comments: [{ body: 'a' }, { body: 'b' }] }))
  await start($)
  await driveTo($, 14)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  await start($)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(2)
  expect(calls.toasts.filter(t => t.startsWith('PR #'))).toEqual([])
})
