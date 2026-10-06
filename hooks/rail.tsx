import type { Elements } from 'claude-code'

import type { CheckState, Run, StepNo } from '../types'
import type { Phase } from './machine'
import { STEPS, isWaitingOnHuman, totalLoops } from './machine'

export const COLORS: Readonly<Record<Phase | 'loop' | 'alert' | 'you' | 'faint' | 'bad', string>> = {
  plan: '#e6b84a',
  spec: '#c48bef',
  build: '#4cc3dc',
  ship: '#6bd38a',
  loop: '#f0a24b',
  alert: '#f0a24b',
  you: '#f5f5f5',
  faint: '#3a4152',
  bad: '#f26b6b',
}

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const PHASE_END: ReadonlySet<number> = new Set([5, 9, 11])

export type RailPart = {
  key: string
  text: string
  group: 'core' | 'activity' | 'pr'
  color?: string
  dim?: boolean
  bold?: boolean
  href?: string
}

export type RailInput = { run: Run; columns: number; frame: number; isWorking: boolean }

export function hintFor(run: Run): string {
  switch (run.step) {
    case 1:
      return 'describe the feature in chat'
    case 4:
      return run.verdicts.plan === 'block' ? 'critic blocked · reply revise or approve' : 'reply approve or what to change'
    case 8:
      return run.verdicts.spec === 'block' ? 'critic blocked · reply revise or approve' : 'reply approve or what to change'
    case 13:
      return 'reply ready or what to fix'
    default:
      return ''
  }
}

function railCells(run: Run, width: number, frame: number): RailPart[] {
  const cells: RailPart[] = []
  const push = (p: Omit<RailPart, 'key' | 'group'>) => {
    const last = cells[cells.length - 1]
    if (last && !p.bold && !p.dim && !last.bold && !last.dim && last.color === p.color) last.text += p.text
    else cells.push({ ...p, key: `c${cells.length}`, group: 'core' })
  }
  for (let n = 1; n <= 15; n++) {
    const s = n as StepNo
    const color = COLORS[STEPS[s].phase]
    if (s === run.step && run.step !== 15) {
      const pulse = frame % 2 === 0
      push({ text: isWaitingOnHuman(run) ? '◈' : '◉', color, bold: pulse, dim: !pulse })
    } else if (run.skipped.includes(s)) {
      push({ text: '┄'.repeat(width), color: COLORS.faint })
    } else if (s < run.step || run.step === 15) {
      push({ text: '━'.repeat(width), color })
    } else {
      push({ text: '─'.repeat(width), color: COLORS.faint })
    }
    if (PHASE_END.has(s)) push({ text: '┃', color: COLORS.faint })
  }
  return cells
}

const CHECK_MARK: Readonly<Record<CheckState, { text: string; color: string }>> = {
  pass: { text: '✔', color: COLORS.ship },
  fail: { text: '✖', color: COLORS.bad },
  running: { text: '', color: COLORS.alert },
  queued: { text: '○', color: COLORS.faint },
}

function prParts(run: Run, frame: number): RailPart[] {
  const pr = run.pr
  if (!pr || run.step < 13) return []
  const parts: RailPart[] = [
    { key: 'pr-sep', text: ' │ ', group: 'pr', color: COLORS.faint },
    { key: 'pr-link', text: `#${pr.number}`, group: 'pr', href: pr.url },
  ]
  if (run.ghFailures >= 3) {
    parts.push({ key: 'pr-unknown', text: ' ?', group: 'pr', dim: true })
    return parts
  }
  if (pr.checks.length) parts.push({ key: 'pr-gap', text: ' ', group: 'pr' })
  pr.checks.forEach((c, i) => {
    const m = CHECK_MARK[c.state]
    parts.push({ key: `pr-check-${i}`, text: c.state === 'running' ? SPIN[frame % SPIN.length] ?? '⠋' : m.text, group: 'pr', color: m.color })
  })
  if (pr.review === 'approved') parts.push({ key: 'pr-review', text: ' approved', group: 'pr', color: COLORS.ship })
  if (pr.review === 'changes') parts.push({ key: 'pr-review', text: ' changes', group: 'pr', color: COLORS.bad })
  return parts
}

function activityPart(run: Run, frame: number, isWorking: boolean): RailPart | null {
  if (run.step === 15) return { key: 'act', text: ' ✔ done', group: 'activity', color: COLORS.ship }
  if (run.step === 14 && run.alert) return { key: 'act', text: ` ⚑ ${run.alert} · reply fix it`, group: 'activity', color: COLORS.alert }
  if (isWaitingOnHuman(run)) return { key: 'act', text: ` ◈ ${hintFor(run)}`, group: 'activity', color: COLORS.you }
  if (run.turnsInStep >= 3 && STEPS[run.step].kind !== 'human') return { key: 'act', text: ' stalled?', group: 'activity', dim: true }
  if (isWorking) return { key: 'act', text: ` ${SPIN[frame % SPIN.length] ?? '⠋'}`, group: 'activity', dim: true }
  return null
}

export function railText(parts: readonly RailPart[]): string {
  return parts.map(p => p.text).join('')
}

export function railParts({ run, columns, frame, isWorking }: RailInput): RailPart[] {
  const width = columns < 60 ? 1 : 2
  const color = COLORS[STEPS[run.step].phase]
  const core: RailPart[] = [
    ...railCells(run, width, frame),
    { key: 'pos', text: `  ${run.step}/15 `, group: 'core', dim: true },
    { key: 'name', text: STEPS[run.step].name, group: 'core', color, bold: true },
  ]
  const activity = activityPart(run, frame, isWorking)
  const loops = totalLoops(run)
  const loopPart: RailPart[] = loops > 0 ? [{ key: 'loops', text: ` ↺${loops}`, group: 'core', color: COLORS.loop }] : []

  let parts: RailPart[] = [...core, ...(activity ? [activity] : []), ...loopPart, ...prParts(run, frame)]
  for (const drop of ['pr', 'activity'] as const) {
    if (railText(parts).length <= columns) break
    parts = parts.filter(p => p.group !== drop)
  }
  return parts
}

export type RailEls = {
  Box: Elements['terminal']['Box']
  Text: Elements['terminal']['Text']
  Link: Elements['terminal']['Link']
}

export function drawRail(els: RailEls, parts: readonly RailPart[]) {
  const { Box, Text, Link } = els
  return (
    <Box flexDirection="row">
      {parts.map(p =>
        p.href ? (
          <Link key={p.key} href={p.href} label={p.text} />
        ) : (
          <Text key={p.key} color={p.color} dimColor={p.dim} bold={p.bold} wrap="truncate">
            {p.text}
          </Text>
        ),
      )}
    </Box>
  )
}
