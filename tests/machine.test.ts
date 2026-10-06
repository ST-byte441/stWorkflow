import { expect, test } from 'claude-code/testing'

import type { Run, StepNo } from '../types'
import { advance, EDGES, isWaitingOnHuman, newRun, noteHuman, STEPS, totalLoops } from '../hooks/machine'

function go(run: Run, to: StepNo, extra: { verdict?: string; pr?: unknown } = {}): Run {
  const r = advance(run, { to, ...extra, now: 1000 })
  if (!r.ok) throw new Error(r.error)
  return r.run
}
function reply(run: Run): Run {
  return noteHuman(run)
}
function toPlanReview(): Run {
  let r = newRun({ id: 'r1', feature: 'Add dark mode toggle', now: 0 })
  r = go(r, 2)
  r = go(r, 3)
  return go(r, 4, { verdict: 'pass' })
}

test('every step has a name and edges', async () => {
  for (let n = 1; n <= 15; n++) {
    expect(STEPS[n as StepNo].name.length).toBeGreaterThan(0)
    expect(Array.isArray(EDGES[n as StepNo])).toBe(true)
  }
  expect(EDGES[15]).toEqual([])
})

test('a run started with a feature can leave step 1 at once', async () => {
  const r = newRun({ id: 'r1', feature: 'Add dark mode toggle', now: 0 })
  expect(r.step).toBe(1)
  expect(r.humanSeq).toBe(1)
  expect(isWaitingOnHuman(r)).toBe(false)
  expect(go(r, 2).step).toBe(2)
})

test('a run started without a feature waits for the human', async () => {
  const r = newRun({ id: 'r1', feature: '   ', now: 0 })
  expect(isWaitingOnHuman(r)).toBe(true)
  const res = advance(r, { to: 2, now: 1 })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain("hasn't replied")
  expect(go(reply(r), 2).step).toBe(2)
})

test('illegal moves name the legal ones', async () => {
  const r = go(newRun({ id: 'r1', feature: 'x', now: 0 }), 2)
  const res = advance(r, { to: 4, now: 1 })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toBe('Illegal move 2 → 4. From step 2 (plan) you can go to: 3 (plan critic).')
})

test('rejects malformed targets', async () => {
  const r = go(newRun({ id: 'r1', feature: 'x', now: 0 }), 2)
  for (const to of ['3', 3.5, 0, 16, null, undefined]) {
    const res = advance(r, { to, now: 1 })
    expect(res.ok).toBe(false)
  }
})

test('leaving a critic step needs a verdict, which is recorded', async () => {
  let r = go(go(newRun({ id: 'r1', feature: 'x', now: 0 }), 2), 3)
  const res = advance(r, { to: 4, now: 1 })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain('verdict')
  r = go(r, 4, { verdict: 'block' })
  expect(r.verdicts.plan).toBe('block')
})

test('a gate needs a reply sent after it opened', async () => {
  const atGate = toPlanReview()
  expect(isWaitingOnHuman(atGate)).toBe(true)
  expect(advance(atGate, { to: 5, now: 1 }).ok).toBe(false)
  const answered = reply(atGate)
  expect(isWaitingOnHuman(answered)).toBe(false)
  let r = go(answered, 5)
  r = go(r, 6)
  r = go(r, 7)
  r = go(r, 8, { verdict: 'pass' })
  // the reply given at the plan gate does not open the spec gate
  expect(advance(r, { to: 9, now: 1 }).ok).toBe(false)
  expect(go(reply(r), 9).step).toBe(9)
})

test('loops count where they happen', async () => {
  let r = go(reply(toPlanReview()), 5)
  r = go(r, 2)
  expect(r.iter.plan).toBe(2)
  r = go(go(r, 3), 4, { verdict: 'pass' })
  r = go(go(go(reply(r), 5), 6), 7)
  r = go(r, 8, { verdict: 'pass' })
  r = go(reply(r), 9)
  r = go(r, 7)
  expect(r.iter.spec).toBe(2)
  r = go(reply(go(r, 8, { verdict: 'pass' })), 9)
  r = go(go(r, 10), 11)
  r = go(r, 10, { verdict: 'block' })
  expect(r.iter.code).toBe(2)
  r = go(go(r, 11), 12, { verdict: 'pass' })
  r = go(r, 13, { pr: { number: 128, url: 'https://github.com/acme/web/pull/128' } })
  r = go(reply(r), 10)
  expect(r.iter.code).toBe(3)
  expect(r.shipLoops).toBe(1)
  expect(totalLoops(r)).toBe(4)
})

test('opening a PR needs its number and url', async () => {
  let r = go(go(go(reply(toPlanReview()), 5), 6), 7)
  r = go(reply(go(r, 8, { verdict: 'pass' })), 9)
  r = go(go(go(r, 10), 11), 12, { verdict: 'pass' })
  expect(advance(r, { to: 13, now: 1 }).ok).toBe(false)
  expect(advance(r, { to: 13, pr: { number: 7 }, now: 1 }).ok).toBe(false)
  const opened = go(r, 13, { pr: { number: 128, url: 'https://github.com/acme/web/pull/128' } })
  expect(opened.pr?.state).toBe('draft')
  const ready = go(reply(opened), 14)
  expect(ready.pr?.state).toBe('ready')
  const skipped = go(r, 15)
  expect(skipped.skipped).toEqual([13, 14])
})

test('a human reply clears the alert; leaving 14 clears it too', async () => {
  const r: Run = { ...newRun({ id: 'r1', feature: 'x', now: 0 }), alert: 'e2e failed' }
  expect(noteHuman(r).alert).toBe(undefined)
})

test('history records each move', async () => {
  const r = go(go(newRun({ id: 'r1', feature: 'x', now: 0 }), 2), 3)
  expect(r.history.map(h => h.step)).toEqual([1, 2, 3])
  expect(r.history[2]?.text).toBe('plan → plan critic')
})

function toPrReview(): Run {
  let r = go(go(go(reply(toPlanReview()), 5), 6), 7)
  r = go(reply(go(r, 8, { verdict: 'pass' })), 9)
  r = go(go(go(r, 10), 11), 12, { verdict: 'pass' })
  return go(r, 13, { pr: { number: 128, url: 'https://github.com/acme/web/pull/128' } })
}

test('the 12 → 13 loop keeps the existing PR', async () => {
  const opened = toPrReview()
  const seen: Run = { ...opened, pr: { ...opened.pr!, state: 'ready', checks: [{ name: 'e2e', state: 'fail' }], comments: 3, review: 'changes' } }
  let r = go(reply(seen), 10)
  r = go(go(r, 11), 12, { verdict: 'pass' })
  const again = go(r, 13)
  expect(again.pr).toEqual(seen.pr)
  const same = go(r, 13, { pr: { number: 128, url: 'https://github.com/acme/web/pull/128' } })
  expect(same.pr).toEqual(seen.pr)
  const other = go(r, 13, { pr: { number: 131, url: 'https://github.com/acme/web/pull/131' } })
  expect(other.pr).toEqual({ number: 131, url: 'https://github.com/acme/web/pull/131', state: 'draft', checks: [], review: 'none', comments: 0 })
  expect(advance(r, { to: 13, pr: { number: 7 }, now: 1 }).ok).toBe(false)
})

test('entering 14 asks the watcher for a fresh baseline', async () => {
  const opened = toPrReview()
  const watching = go(reply(opened), 14)
  expect(watching.watchBaselined).toBe(false)
  expect(go(watching, 10).watchBaselined).toBe(undefined)
})
