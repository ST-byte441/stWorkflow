import { expect, test } from 'claude-code/testing'

import type { Run } from '../types'
import { newRun, noteHuman } from '../hooks/machine'
import { railParts, railText } from '../hooks/rail'
import { driveTo, start, stubEngine } from './helpers'

function at(step: Run['step'], patch: Partial<Run> = {}): Run {
  return { ...newRun({ id: 'r', feature: 'x', now: 0 }), step, gateSeq: 1, humanSeq: 1, ...patch }
}
const line = (run: Run, o: { columns?: number; frame?: number; isWorking?: boolean } = {}) =>
  railText(railParts({ run, columns: o.columns ?? 160, frame: o.frame ?? 0, isWorking: o.isWorking ?? false }))

test('plan review waiting on the human', async () => {
  expect(line(at(4))).toBe('━━━━━━◈──┃────────┃────┃────────  4/15 plan review ◈ reply approve or what to change')
})

test('blocked critic changes the hint', async () => {
  expect(line(at(4, { verdicts: { plan: 'block' } }))).toContain('◈ critic blocked · reply revise or approve')
})

test('after the human replies the head turns into the working glyph', async () => {
  const replied = noteHuman(at(4))
  expect(line(replied)).toContain('━━━━━━◉──┃')
  expect(line(replied)).not.toContain('◈ reply')
})

test('working shows a spinner and loops show a count', async () => {
  const run = at(10, { iter: { plan: 2, spec: 1, code: 1 } })
  expect(line(run, { isWorking: true, frame: 0 })).toBe('━━━━━━━━━━┃━━━━━━━━┃◉──┃────────  10/15 build ⠋ ↺1')
})

test('stalled hint after three turns', async () => {
  expect(line(at(2, { turnsInStep: 3 }))).toContain(' stalled?')
})

test('PR part with checks and review', async () => {
  const run = at(14, {
    pr: { number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'approved', comments: 0,
      checks: [{ name: 'lint', state: 'pass' }, { name: 'unit', state: 'fail' }, { name: 'e2e', state: 'queued' }] },
  })
  expect(line(run)).toContain('14/15 watching PR │ #128 ✔✖○ approved')
  const link = railParts({ run, columns: 160, frame: 0, isWorking: false }).find(p => p.href)
  expect(link?.href).toBe('https://github.com/acme/web/pull/128')
})

test('GitHub unreachable shows a question mark', async () => {
  const run = at(14, { ghFailures: 3, pr: { number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'none', comments: 0, checks: [] } })
  expect(line(run)).toContain('#128 ?')
})

test('alert replaces the activity', async () => {
  expect(line(at(14, { alert: 'e2e failed' }))).toContain('14/15 watching PR ⚑ e2e failed · reply fix it')
})

test('skipped PR steps and done', async () => {
  expect(line(at(15, { skipped: [13, 14] }))).toBe('━━━━━━━━━━┃━━━━━━━━┃━━━━┃━━┄┄┄┄━━  15/15 done ✔ done')
})

test('narrow terminals use one char per step', async () => {
  expect(line(at(4), { columns: 50 }).startsWith('━━━◈─┃────┃──┃────  4/15')).toBe(true)
})

test('drops PR then activity when narrow', async () => {
  const run = at(14, {
    alert: 'e2e failed',
    pr: { number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'none', comments: 0, checks: [{ name: 'lint', state: 'pass' }] },
  })
  const wide = railParts({ run, columns: 200, frame: 0, isWorking: false }).map(p => p.group)
  expect(wide).toContain('pr')
  expect(wide).toContain('activity')
  const mid = railParts({ run, columns: 85, frame: 0, isWorking: false }).map(p => p.group)
  expect(mid).not.toContain('pr')
  expect(mid).toContain('activity')
  const narrow = railParts({ run, columns: 60, frame: 0, isWorking: false })
  expect(narrow.map(p => p.group)).not.toContain('activity')
  expect(railText(narrow).length).toBeLessThanOrEqual(60)
})

const ABOVE = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns, scroll: { offset: 0, bodyRows: 0 }, view: {} },
})

test('the rail is drawn on terminal and desktop while a run is active', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 4)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'stworkflow', surface, ...ABOVE(160) })
    expect((await ui.find({ type: 'Text', text: /4\/15/ }))?.text).toBe('  4/15 ')
    expect((await ui.find({ type: 'Text', text: /reply approve/ }))?.text).toBe(' ◈ reply approve or what to change')
    await ui.unmount()
  }
})

test('no run, no rail', async ($, on) => {
  stubEngine(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'stworkflow', surface, ...ABOVE(160) })
    expect(await ui.find({ type: 'Text', text: /\/15/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
})

test('the PR number is a link to the PR', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 13)
  const ui = await $.ui.mount({ plugin: 'stworkflow', surface: 'terminal', ...ABOVE(160) })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://github.com/acme/web/pull/128')
  await ui.unmount()
})
