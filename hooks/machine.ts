import type { Run, StepNo } from '../types'

export type Phase = 'plan' | 'spec' | 'build' | 'ship'
export type Kind = 'human' | 'work' | 'critic' | 'route' | 'watch' | 'end'

export const STEPS: Readonly<Record<StepNo, { name: string; phase: Phase; kind: Kind }>> = {
  1: { name: 'input', phase: 'plan', kind: 'human' },
  2: { name: 'plan', phase: 'plan', kind: 'work' },
  3: { name: 'plan critic', phase: 'plan', kind: 'critic' },
  4: { name: 'plan review', phase: 'plan', kind: 'human' },
  5: { name: 'route', phase: 'plan', kind: 'route' },
  6: { name: 'spec', phase: 'spec', kind: 'work' },
  7: { name: 'spec critic', phase: 'spec', kind: 'critic' },
  8: { name: 'spec review', phase: 'spec', kind: 'human' },
  9: { name: 'route', phase: 'spec', kind: 'route' },
  10: { name: 'build', phase: 'build', kind: 'work' },
  11: { name: 'code critic', phase: 'build', kind: 'critic' },
  12: { name: 'draft PR', phase: 'ship', kind: 'work' },
  13: { name: 'PR review', phase: 'ship', kind: 'human' },
  14: { name: 'watching PR', phase: 'ship', kind: 'watch' },
  15: { name: 'done', phase: 'ship', kind: 'end' },
}

export const EDGES: Readonly<Record<StepNo, readonly StepNo[]>> = {
  1: [2], 2: [3], 3: [4], 4: [5], 5: [2, 6], 6: [7], 7: [8], 8: [9], 9: [7, 10],
  10: [11], 11: [10, 12], 12: [13, 15], 13: [10, 14], 14: [10, 15], 15: [],
}

export function isStep(n: unknown): n is StepNo {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 15
}

export function isHumanStep(run: Run): boolean {
  return STEPS[run.step].kind === 'human'
}

export function isWaitingOnHuman(run: Run): boolean {
  return isHumanStep(run) && run.humanSeq <= run.gateSeq
}

export function totalLoops(run: Run): number {
  return run.iter.plan - 1 + (run.iter.spec - 1) + (run.iter.code - 1)
}

export function newRun(o: { id: string; feature: string; now: number }): Run {
  const feature = o.feature.trim()
  return {
    version: 1,
    id: o.id,
    feature,
    step: 1,
    startedAt: o.now,
    iter: { plan: 1, spec: 1, code: 1 },
    shipLoops: 0,
    humanSeq: feature ? 1 : 0,
    gateSeq: 0,
    turnsInStep: 0,
    skipped: [],
    verdicts: {},
    ghFailures: 0,
    history: [{ at: o.now, step: 1, text: feature ? `started: ${feature}` : 'started' }],
  }
}

export function noteHuman(run: Run): Run {
  const { alert: _cleared, ...rest } = run
  return { ...rest, humanSeq: run.humanSeq + 1 }
}

export type AdvanceInput = { to: unknown; verdict?: unknown; pr?: unknown; now: number }
export type AdvanceResult = { ok: true; run: Run } | { ok: false; error: string }

function parsePrRef(v: unknown): { number: number; url: string } | null {
  if (typeof v !== 'object' || v === null) return null
  const { number, url } = v as Record<string, unknown>
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  return { number, url }
}

export function advance(run: Run, input: AdvanceInput): AdvanceResult {
  const from = run.step
  const legal = EDGES[from]
  const to = input.to
  if (!isStep(to) || !legal.includes(to)) {
    const list = legal.length
      ? legal.map(n => `${n} (${STEPS[n].name})`).join(', ')
      : 'nowhere; the run is complete'
    return { ok: false, error: `Illegal move ${from} → ${String(to)}. From step ${from} (${STEPS[from].name}) you can go to: ${list}.` }
  }
  if (isWaitingOnHuman(run)) {
    return {
      ok: false,
      error: `The human hasn't replied since step ${from} (${STEPS[from].name}) opened. Ask them, then wait for their reply before calling workflow_advance.`,
    }
  }

  const next: Run = {
    ...run,
    iter: { ...run.iter },
    verdicts: { ...run.verdicts },
    skipped: [...run.skipped],
    history: [...run.history],
  }

  const verdict = input.verdict
  if (from === 3 || from === 7 || from === 11) {
    if (verdict !== 'pass' && verdict !== 'block') {
      return { ok: false, error: `Leaving the ${STEPS[from].name} step needs verdict: "pass" or "block".` }
    }
    const key = from === 3 ? 'plan' : from === 7 ? 'spec' : 'code'
    next.verdicts[key] = verdict
  }

  if (from === 12 && to === 13) {
    const pr = input.pr === undefined && run.pr ? null : parsePrRef(input.pr)
    if (!pr && !run.pr) return { ok: false, error: 'Moving to step 13 needs pr: { number, url } for the draft PR you opened.' }
    if (!pr && input.pr !== undefined) return { ok: false, error: 'pr must be { number, url } for the PR; omit it to keep the existing PR.' }
    if (pr && pr.number !== run.pr?.number) {
      next.pr = { number: pr.number, url: pr.url, state: 'draft', checks: [], review: 'none', comments: 0 }
    }
  }

  if (from === 5 && to === 2) next.iter.plan += 1
  if (from === 9 && to === 7) next.iter.spec += 1
  if (to === 10 && from !== 9) next.iter.code += 1
  if ((from === 13 || from === 14) && to === 10) next.shipLoops += 1
  if (from === 12 && to === 15) next.skipped = [13, 14]
  if (from === 13 && to === 14 && next.pr) next.pr = { ...next.pr, state: 'ready' }
  if (from === 14) delete next.alert

  next.step = to
  next.turnsInStep = 0
  if (STEPS[to].kind === 'human') next.gateSeq = next.humanSeq
  const tail = typeof verdict === 'string' ? ` (${verdict})` : ''
  next.history.push({ at: input.now, step: to, text: `${STEPS[from].name} → ${STEPS[to].name}${tail}` })
  return { ok: true, run: next }
}
