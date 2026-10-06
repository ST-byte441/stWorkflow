import type { CheckState, Pr } from '../types'

export const GH_FIELDS = 'number,url,state,isDraft,reviewDecision,statusCheckRollup,comments,reviews'
export const FIRST_POLL_MS = 5_000

export function nextDelay(failures: number): number {
  if (failures <= 1) return 60_000
  if (failures === 2) return 120_000
  return 300_000
}

const PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', 'ERROR'])

export function checkState(c: Record<string, unknown>): CheckState {
  const conclusion = String(c.conclusion ?? '').toUpperCase()
  const status = String(c.status ?? '').toUpperCase()
  const state = String(c.state ?? '').toUpperCase()
  if (PASS.has(conclusion) || state === 'SUCCESS') return 'pass'
  if (FAIL.has(conclusion) || state === 'FAILURE' || state === 'ERROR') return 'fail'
  if (status === 'IN_PROGRESS' || state === 'PENDING') return 'running'
  return 'queued'
}

type Review = { author: string; state: string; body: string }

function parseReviews(v: unknown): Review[] {
  if (!Array.isArray(v)) return []
  const out: Review[] = []
  for (const r of v as unknown[]) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const author = typeof o.author === 'object' && o.author !== null ? (o.author as Record<string, unknown>).login : undefined
    if (typeof author !== 'string' || !author || typeof o.state !== 'string') continue
    out.push({ author, state: o.state, body: typeof o.body === 'string' ? o.body : '' })
  }
  return out
}

/** Each author's latest APPROVED / CHANGES_REQUESTED review decides; any change request wins. */
function reviewFrom(reviews: readonly Review[]): Pr['review'] {
  const latest = new Map<string, string>()
  for (const r of reviews) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') latest.set(r.author, r.state)
  }
  const states = [...latest.values()]
  if (states.includes('CHANGES_REQUESTED')) return 'changes'
  if (states.includes('APPROVED')) return 'approved'
  return 'none'
}

export function parseGh(stdout: string): Pr | null {
  let j: unknown
  try {
    j = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null
  const o = j as Record<string, unknown>
  if (typeof o.number !== 'number' || typeof o.url !== 'string' || typeof o.state !== 'string') return null
  const state: Pr['state'] = o.state === 'MERGED' ? 'merged' : o.state === 'CLOSED' ? 'closed' : o.isDraft ? 'draft' : 'ready'
  const reviews = parseReviews(o.reviews)
  const review: Pr['review'] =
    o.reviewDecision === 'APPROVED' ? 'approved' : o.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : reviewFrom(reviews)
  const rollup = Array.isArray(o.statusCheckRollup) ? (o.statusCheckRollup as unknown[]).filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null) : []
  const checks = rollup.map(c => ({ name: String(c.name ?? c.context ?? 'check'), state: checkState(c) }))
  const reviewComments = reviews.filter(r => r.body.trim() !== '' || r.state === 'COMMENTED').length
  const comments = (Array.isArray(o.comments) ? o.comments.length : 0) + reviewComments
  return { number: o.number, url: o.url, state, review, checks, comments }
}

export type PrEvent = { text: string; alert?: string }

const allPass = (p: Pr) => p.checks.length > 0 && p.checks.every(c => c.state === 'pass')

export function diffPr(prev: Pr, next: Pr): PrEvent[] {
  const name = `PR #${next.number}`
  const events: PrEvent[] = []
  for (const c of next.checks) {
    const before = prev.checks.find(p => p.name === c.name)
    if (c.state === 'fail' && before?.state !== 'fail') events.push({ text: `${name}: CI failed on ${c.name}`, alert: `${c.name} failed` })
  }
  if (allPass(next) && !allPass(prev)) events.push({ text: `${name}: all checks passed` })
  if (next.review !== prev.review) {
    if (next.review === 'approved') events.push({ text: `${name} was approved` })
    if (next.review === 'changes') events.push({ text: `${name}: changes requested`, alert: 'changes requested' })
  }
  if (next.comments > prev.comments) {
    const k = next.comments - prev.comments
    events.push({ text: `${name}: ${k} new comment${k === 1 ? '' : 's'}`, alert: 'new comment' })
  }
  if (next.state !== prev.state) {
    if (next.state === 'merged') events.push({ text: `${name} was merged` })
    if (next.state === 'closed') events.push({ text: `${name} was closed without merging`, alert: 'PR closed' })
  }
  return events
}
