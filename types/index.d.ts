export type StepNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15
export type Verdict = 'pass' | 'block'
export type CheckState = 'pass' | 'fail' | 'running' | 'queued'

export type Pr = {
  number: number
  url: string
  state: 'draft' | 'ready' | 'merged' | 'closed'
  checks: { name: string; state: CheckState }[]
  review: 'none' | 'approved' | 'changes'
  comments: number
}

export type Run = {
  version: 1
  id: string
  feature: string
  step: StepNo
  startedAt: number
  iter: { plan: number; spec: number; code: number }
  shipLoops: number
  humanSeq: number
  gateSeq: number
  turnsInStep: number
  skipped: StepNo[]
  verdicts: { plan?: Verdict; spec?: Verdict; code?: Verdict }
  pr?: Pr
  alert?: string
  ghFailures: number
  /** False from entering step 14 (or reloading into it) until the first successful poll sets the comment/review baseline. */
  watchBaselined?: boolean
  history: { at: number; step: StepNo; text: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    stworkflow: { run: Run | null }
  }
}
