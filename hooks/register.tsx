import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Run } from '../types'
import { statusText, stepGuide } from './compose'
import { STEPS, advance, isWaitingOnHuman, newRun, noteHuman } from './machine'
import { drawRail, railParts } from './rail'
import { parseRun, storeKey } from './store'
import { FIRST_POLL_MS, GH_FIELDS, diffPr, nextDelay, parseGh } from './watch'

const TOOL = 'mcp__stworkflow__workflow_advance'

const ADVANCE_DESCRIPTION = [
  'Report a step change in the stWorkflow run.',
  'Start a run with to: 1 and feature (a one-line summary of what the human asked for).',
  'Leaving a critic step (3, 7, 11) needs verdict "pass" or "block".',
  'Moving from 12 to 13 needs pr: { number, url } for the draft PR; when the run already has a PR (a return from review), omit pr to keep it.',
  'The tool refuses illegal moves, and refuses to leave a human-review step (1, 4, 8, 13) before the human has replied.',
].join(' ')

const ADVANCE_SCHEMA = {
  type: 'object',
  properties: {
    to: { type: 'integer', minimum: 1, maximum: 15, description: 'The step to move to' },
    feature: { type: 'string', description: 'One-line summary of the feature; only with to: 1' },
    verdict: { type: 'string', enum: ['pass', 'block'], description: "The critic's verdict when leaving step 3, 7 or 11" },
    pr: {
      type: 'object',
      properties: { number: { type: 'integer' }, url: { type: 'string' } },
      required: ['number', 'url'],
      description: 'The draft PR, when moving from 12 to 13 for the first time',
    },
  },
  required: ['to'],
}

const HUMAN_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])

const run = atom({ plugin: 'stworkflow', key: 'run' } as const, null as Run | null)

let frame = 0
let isActive = false
let ticker: Timer | undefined
let watchTimer: Timer | undefined

async function save($: EngineInterface, next: Run | null): Promise<void> {
  await update($, run, () => next)
  isActive = next !== null
  const key = storeKey(await $.session.root())
  if (next) await $.store.set(key, next)
  else await $.store.delete(key)
}

function startTicker($: EngineInterface): void {
  ticker?.cancel()
  ticker = $.clock.every(500, () => {
    frame += 1
    if (isActive) $.ui.invalidate('ui.render')
  })
}

function stopWatch(): void {
  watchTimer?.cancel()
  watchTimer = undefined
}

function scheduleWatch($: EngineInterface, ms: number): void {
  stopWatch()
  watchTimer = $.clock.after(ms, () => {
    void pollPr($)
  })
}

async function pollPr($: EngineInterface): Promise<void> {
  watchTimer = undefined
  const current = await read($, run)
  if (!current || current.step !== 14 || !current.pr) return

  let res: { exitCode: number; stdout: string; stderr: string }
  try {
    res = await $.process.run(['gh', 'pr', 'view', String(current.pr.number), '--json', GH_FIELDS], { timeoutMs: 20_000 })
  } catch (err) {
    res = { exitCode: -1, stdout: '', stderr: String(err) }
  }
  const fresh = res.exitCode === 0 ? parseGh(res.stdout) : null

  const latest = await read($, run)
  if (!latest || latest.id !== current.id || latest.step !== current.step || !latest.pr) return

  if (!fresh) {
    const failures = latest.ghFailures + 1
    if (failures === 3) {
      const reason = (res.stderr.split('\n')[0] || 'gh returned output stWorkflow could not read').slice(0, 120)
      $.ui.toast(`stWorkflow: can't reach GitHub: ${reason}`)
      $.ui.log(`⚑ can't reach GitHub: ${reason}`)
    }
    await save($, { ...latest, ghFailures: failures })
    scheduleWatch($, nextDelay(failures))
    return
  }

  const events = diffPr(latest.pr, fresh)
  for (const ev of events) {
    $.ui.toast(ev.text)
    $.ui.log(`⚑ ${ev.text}`)
  }
  const alert = [...events].reverse().find(ev => ev.alert)?.alert
  let next: Run = { ...latest, pr: fresh, ghFailures: 0 }
  if (alert) next.alert = alert

  if (fresh.state === 'merged') {
    const done = advance(next, { to: 15, now: await $.clock.now() })
    if (done.ok) next = done.run
  }
  await save($, next)
  if (next.step === 15) $.ui.toast('stWorkflow: run complete.')
  if (next.step === 14 && fresh.state !== 'closed') scheduleWatch($, nextDelay(0))
}

async function afterMove($: EngineInterface, next: Run): Promise<void> {
  if (isWaitingOnHuman(next)) $.ui.toast(`stWorkflow: your turn · ${STEPS[next.step].name}`)
  if (next.step === 14) scheduleWatch($, FIRST_POLL_MS)
  else stopWatch()
  if (next.step === 15) $.ui.toast('stWorkflow: run complete.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'workflow_advance', description: ADVANCE_DESCRIPTION, inputSchema: ADVANCE_SCHEMA })
    await $.command.register({ name: 'stWorkflow-status', description: 'Show the current stWorkflow run' })
    await $.command.register({ name: 'stWorkflow-abort', description: 'Abandon the current stWorkflow run' })
    const { run: restored, discarded } = parseRun(await $.store.get(storeKey(await $.session.root())))
    if (discarded) $.ui.log('stWorkflow: discarded a saved run from an older version.')
    await save($, restored)
    startTicker($)
    if (restored?.step === 14) scheduleWatch($, FIRST_POLL_MS)
    else stopWatch()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const current = await read($, run)
    if (current && HUMAN_ORIGINS.has(e.origin.kind)) {
      if (current.step === 15) await save($, null)
      else await save($, noteHuman(current))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const current = await read($, run)
    if (current && current.step !== 15 && !isWaitingOnHuman(current)) {
      await save($, { ...current, turnsInStep: current.turnsInStep + 1 })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const now = await $.clock.now()
    const current = await read($, run)

    if (e.to === 1) {
      if (current && current.step !== 15) {
        return {
          deny: `A run is already active: "${current.feature}" at step ${current.step}/15 (${STEPS[current.step].name}). Ask the human whether to resume it (carry on from that step) or abandon it with /stWorkflow-abort.`,
        }
      }
      const created = newRun({ id: `${now}-${Math.random().toString(36).slice(2, 8)}`, feature: typeof e.feature === 'string' ? e.feature : '', now })
      await save($, created)
      await afterMove($, created)
      return { result: `Run started.\n\n${stepGuide(created)}` }
    }

    if (!current) return { deny: 'No stWorkflow run is active. Start one with workflow_advance({ to: 1, feature }).' }
    const moved = advance(current, { to: e.to, verdict: e.verdict, pr: e.pr, now })
    if (!moved.ok) return { deny: moved.error }
    await save($, moved.run)
    await afterMove($, moved.run)
    return { result: `Now at step ${moved.run.step}/15 (${STEPS[moved.run.step].name}).\n\n${stepGuide(moved.run)}` }
  }).catch(() => ({ deny: 'stWorkflow hit an internal error; run claude --debug and check the debug log.' }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    let current: Run | null = null
    try {
      current = await read($, run)
    } catch {
      return composed
    }
    if (!current) return composed
    return { sections: [...composed.sections, { id: 'stworkflow', text: stepGuide(current), scope: 'session' }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, run)
    if (!current || e.props.hasSurvey) return next(e)
    const parts = railParts({ run: current, columns: e.props.bodyColumns, frame, isWorking: e.props.isWorking })
    return drawRail($.ui.resolve(e), parts)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'stWorkflow-status' }, async $ => ({ text: statusText(await read($, run)) })).catch(() => ({ text: 'stWorkflow hit an internal error; run claude --debug and check the debug log.' }))

  on('command.run', { command: 'stWorkflow-abort' }, async $ => {
    const current = await read($, run)
    if (!current) return { text: 'No stWorkflow run is active.' }
    stopWatch()
    await save($, null)
    return { text: `Abandoned the run "${current.feature}" at step ${current.step}/15.` }
  }).catch(() => ({ text: 'stWorkflow hit an internal error; run claude --debug and check the debug log.' }))
}
