import { expect, test } from 'claude-code/testing'

import { adv, driveTo, GOOD_PR, say, runCommand, start, status, stubEngine } from './helpers'

test('starting a run returns the step guide and shows the run', async ($, on) => {
  stubEngine(on)
  await start($)
  const r = await adv($, { to: 1, feature: 'Add dark mode toggle to Settings' })
  expect(String(r.result)).toContain('Run started.')
  expect(String(r.result)).toContain('Current step 1/15: input.')
  expect(await status($)).toContain('Step 1/15 · input')
})

test('a second start while a run is active is refused', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  const r = await adv($, { to: 1, feature: 'Something else' })
  expect(r.deny).toContain('A run is already active: "Add dark mode toggle to Settings" at step 2/15 (plan).')
})

test('moves without a run are refused', async ($, on) => {
  stubEngine(on)
  await start($)
  expect((await adv($, { to: 2 })).deny).toContain('No stWorkflow run is active.')
})

test('illegal moves are refused with the legal ones', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  expect((await adv($, { to: 6 })).deny).toBe('Illegal move 2 → 6. From step 2 (plan) you can go to: 3 (plan critic).')
})

test('a gate opens only after the human replies', async ($, on) => {
  const calls = stubEngine(on)
  await start($)
  await driveTo($, 3)
  await adv($, { to: 4, verdict: 'pass' })
  expect(calls.toasts).toContain('stWorkflow: your turn · plan review')
  expect((await adv($, { to: 5 })).deny).toContain("hasn't replied")
  await say($, 'looks good, approve')
  expect((await adv($, { to: 5 })).result).toBeDefined()
})

test('non-human prompts do not open a gate', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 4)
  await say($, 'background task finished', 'task-notification')
  expect((await adv($, { to: 5 })).deny).toContain("hasn't replied")
})

test('a saved run is restored on session start', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 6)
  await start($)
  expect(await status($)).toContain('Step 6/15 · spec')
})

test('a saved run from another version is discarded with a note', async ($, on) => {
  const calls = stubEngine(on, undefined, { 'run:/repo': { version: 0, step: 3 } })
  await start($)
  expect(await status($)).toBe('No stWorkflow run is active.')
  expect(calls.logs).toContain('stWorkflow: discarded a saved run from an older version.')
})

test('abort ends the run', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  const r = await runCommand($, 'stWorkflow-abort')
  expect(r.text).toBe('Abandoned the run "Add dark mode toggle to Settings" at step 2/15.')
  expect(await status($)).toBe('No stWorkflow run is active.')
})

test('no repo: 12 → 15, then the next prompt clears the finished run', async ($, on) => {
  const calls = stubEngine(on)
  await start($)
  await driveTo($, 12)
  await adv($, { to: 15 })
  expect(calls.toasts).toContain('stWorkflow: run complete.')
  expect(await status($)).toContain('Step 15/15 · done')
  await say($, 'thanks')
  expect(await status($)).toBe('No stWorkflow run is active.')
})

test('PR gate: fixes go back to build and count as a ship loop', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 13)
  await say($, 'rename the setting to Appearance')
  await adv($, { to: 10 })
  expect(await status($)).toContain('Step 10/15 · build · 1 revision loop')
  expect(await status($)).toContain(`PR #${GOOD_PR.number} (draft)`)
})

test('a return from PR review pushes to the same PR and advances to 13 without pr', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 13)
  await say($, 'rename the setting to Appearance')
  await adv($, { to: 10 })
  await adv($, { to: 11 })
  const at12 = await adv($, { to: 12, verdict: 'pass' })
  expect(String(at12.result)).toContain('push the new commits to the existing PR #128')
  const at13 = await adv($, { to: 13 })
  expect(at13.deny).toBe(undefined)
  expect(await status($)).toContain(`PR #${GOOD_PR.number} (draft) ${GOOD_PR.url}`)
  expect(await status($)).toContain('Step 13/15 · PR review')
})
