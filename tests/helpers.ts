import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const TOOL = 'mcp__stworkflow__workflow_advance'
export const GOOD_PR = { number: 128, url: 'https://github.com/acme/web/pull/128' }

type GhReply = { exitCode: number; stdout: string; stderr: string }

export function stubEngine(
  on: On,
  gh: (argv: readonly string[]) => GhReply | Promise<GhReply> = () => ({ exitCode: 1, stdout: '', stderr: 'gh: not stubbed' }),
  seed: Readonly<Record<string, unknown>> = {},
) {
  const calls = { toasts: [] as string[], logs: [] as string[], gh: [] as string[][] }
  mock.store(on, seed)
  const clock = mock.clock(on)
  on('session.root', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__stworkflow__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    calls.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', async (_$, e) => {
    calls.gh.push([...e.argv])
    return { value: { ...(await gh(e.argv)), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  return { ...calls, clock }
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

export async function say($: Engine, text: string, kind: 'composer' | 'task-notification' = 'composer'): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind } })
}

export async function adv($: Engine, input: Record<string, unknown>) {
  return $.tool.call({ tool: TOOL, ...input })
}

/** `$.command.run` takes a bare `{ command }` at runtime; the declared input type also lists fields the engine fills in. */
export function runCommand($: Engine, command: string) {
  return ($.command.run as (input: { command: string }) => ReturnType<Engine['command']['run']>)({ command })
}

export async function status($: Engine): Promise<string> {
  return (await runCommand($, 'stWorkflow-status')).text ?? ''
}

const PATH: ReadonlyArray<($: Engine) => ReturnType<typeof adv>> = [
  $ => adv($, { to: 1, feature: 'Add dark mode toggle to Settings' }),
  $ => adv($, { to: 2 }),
  $ => adv($, { to: 3 }),
  $ => adv($, { to: 4, verdict: 'pass' }),
  async $ => { await say($, 'approve'); return adv($, { to: 5 }) },
  $ => adv($, { to: 6 }),
  $ => adv($, { to: 7 }),
  $ => adv($, { to: 8, verdict: 'pass' }),
  async $ => { await say($, 'approve'); return adv($, { to: 9 }) },
  $ => adv($, { to: 10 }),
  $ => adv($, { to: 11 }),
  $ => adv($, { to: 12, verdict: 'pass' }),
  $ => adv($, { to: 13, pr: GOOD_PR }),
  async $ => { await say($, 'ready'); return adv($, { to: 14 }) },
]

/** Moves a fresh run along the happy path until it stands at `target` (1–14). */
export async function driveTo($: Engine, target: number): Promise<void> {
  for (let i = 0; i < target; i++) {
    const r = await PATH[i]!($)
    if (r.deny) throw new Error(`driveTo(${target}) step ${i + 1}: ${r.deny}`)
  }
}
