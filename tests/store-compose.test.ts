import { expect, test } from 'claude-code/testing'

import type { Run } from '../types'
import { newRun } from '../hooks/machine'
import { parseRun, storeKey } from '../hooks/store'
import { statusText, stepGuide } from '../hooks/compose'

const base = (patch: Partial<Run> = {}): Run => ({ ...newRun({ id: 'r', feature: 'Add dark mode toggle', now: 0 }), ...patch })

test('store key and parsing', async () => {
  expect(storeKey('/repo')).toBe('run:/repo')
  expect(parseRun(undefined)).toEqual({ run: null, discarded: false })
  expect(parseRun({ version: 0 })).toEqual({ run: null, discarded: true })
  expect(parseRun('nonsense')).toEqual({ run: null, discarded: true })
  const run = base()
  expect(parseRun(JSON.parse(JSON.stringify(run))).run?.step).toBe(1)
})

test('guide names the step, its instructions and the legal moves', async () => {
  const g = stepGuide(base({ step: 2 }))
  expect(g).toContain('stWorkflow run: "Add dark mode toggle". Current step 2/15: plan.')
  expect(g).toContain('superpowers:brainstorming')
  expect(g).toContain('Legal next steps: 3 (plan critic).')
  expect(g).not.toContain("human's turn")
})

test('guide at a waiting gate tells Claude to wait', async () => {
  const g = stepGuide(base({ step: 4, humanSeq: 1, gateSeq: 1 }))
  expect(g).toContain("This is the human's turn: do not call workflow_advance until they have replied.")
  expect(g).toContain('Legal next steps: 5 (route).')
})

test('critic steps remind Claude about the verdict', async () => {
  expect(stepGuide(base({ step: 7 }))).toContain('verdict')
})

test('status text', async () => {
  expect(statusText(null)).toBe('No stWorkflow run is active.')
  const run = base({
    step: 14,
    iter: { plan: 2, spec: 1, code: 1 },
    alert: 'e2e failed',
    pr: { number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'none', comments: 0, checks: [] },
    history: [{ at: 0, step: 1, text: 'started: Add dark mode toggle' }, { at: 720_000, step: 2, text: 'input → plan' }],
  })
  const t = statusText(run)
  expect(t).toContain('stWorkflow · Add dark mode toggle')
  expect(t).toContain('Step 14/15 · watching PR · 1 revision loop')
  expect(t).toContain('PR #128 (ready) https://github.com/acme/web/pull/128')
  expect(t).toContain('Alert: e2e failed')
  expect(t).toContain('  +12m  2  input → plan')
})

test('step 12 after a return from review reuses the existing PR', async () => {
  const first = stepGuide(base({ step: 12 }))
  expect(first).toContain('gh pr create --draft')
  const pr = { number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready' as const, checks: [], review: 'none' as const, comments: 0 }
  const again = stepGuide(base({ step: 12, pr }))
  expect(again).toContain('push the new commits to the existing PR #128')
  expect(again).toContain('advance to 13')
  expect(again).not.toContain('gh pr create')
})

test('PR review and watch guides cover abandoning and closing the PR', async () => {
  const g13 = stepGuide(base({ step: 13 }))
  expect(g13).toContain('If the human wants to abandon the PR, confirm with them first, then ask them to run /stWorkflow-abort (there is no move from 13 to 15).')
  const g14 = stepGuide(base({ step: 14 }))
  expect(g14).toContain('If the PR is closed without merging, ask the human whether to reopen it or end the run (advance to 15).')
  expect(g14).toContain('If the human wants to stop watching, advance to 15.')
})
