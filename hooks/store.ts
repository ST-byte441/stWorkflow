import type { Run } from '../types'
import { isStep } from './machine'

export function storeKey(root: string): string {
  return `run:${root}`
}

export function parseRun(v: unknown): { run: Run | null; discarded: boolean } {
  if (v === undefined || v === null) return { run: null, discarded: false }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.version === 1 && isStep(o.step) && Array.isArray(o.history) && typeof o.iter === 'object' && o.iter !== null) {
      return { run: v as Run, discarded: false }
    }
  }
  return { run: null, discarded: true }
}
