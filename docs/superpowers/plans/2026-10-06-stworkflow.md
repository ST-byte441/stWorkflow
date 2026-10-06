# stWorkflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `stworkflow` Claude Code plugin: a `/stWorkflow` skill that drives a 15-step plan → spec → build → ship workflow, and a mod that enforces the flow and shows it as a one-line rail above the prompt.

**Architecture:** Pure TypeScript modules (`machine`, `store`, `compose`, `rail`, `watch`) hold all logic and are unit-tested in isolation. One hooks module, `hooks/register.tsx`, is the only file that touches the mods API (`$`): it wires those modules to events (`session.start`, `prompt.submit`, `turn.start`, `tool.call`, `prompt.compose`, `ui.render`, `command.run`) and timers. The skill (`skills/stWorkflow/SKILL.md`) carries the playbook in Markdown.

**Tech Stack:** Claude Code 2.1.290 mods API (function hooks), TypeScript 5, `claude plugin test` / `claude plugin validate`, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-05-stworkflow-design.md`

## Global Constraints

- Target Claude Code **2.1.290** or later; the hooks module imports only from `'claude-code'` (types, `atom`, `read`, `update`) and relative files.
- Every `$` call lives in `hooks/register.tsx`, written in full (`$.ui.toast(...)`), never through a variable. `$` may be passed only to functions declared at the top level of `register.tsx`. Passing `$` to an imported function fails `claude plugin validate`.
- Event names in `on(...)` are string literals. No `require`, no dynamic `import()`.
- Plugin name `stworkflow`; tool `workflow_advance` (model sees `mcp__stworkflow__workflow_advance`); commands `stWorkflow-status`, `stWorkflow-abort`; skill `stWorkflow`.
- Store key `run:<project root>`; stored run has `version: 1`.
- Phase colours: plan `#e6b84a`, spec `#c48bef`, build `#4cc3dc`, ship `#6bd38a`; loops/alerts `#f0a24b`; human hint `#f5f5f5`; faint `#3a4152`.
- Rail: 15 cells × 2 chars, `┃` after steps 5, 9 and 11; 1 char per cell below 60 columns; drop the PR part, then the activity part, when the line doesn't fit.
- PR polling: first poll 5 s after entering step 14, then every 60 s; after failures back off 60 s → 120 s → 300 s; one toast + transcript line at the 3rd failure in a row.
- No buttons, panes or forms. All interaction is chat.

### Spec refinements made in this plan

These implement the spec's intent with different mechanics; reviewers should check them, not flag them:

1. **Gate guard uses counters, not timestamps.** `humanSeq` increments on each human prompt; entering a gate sets `gateSeq = humanSeq`; leaving a gate needs `humanSeq > gateSeq`. This avoids same-millisecond ties.
2. **Only human prompts count.** A `prompt.submit` counts as the human speaking only when `origin.kind` is `composer` or `bridge`. Plugin, SDK, scheduled and task-notification prompts don't open gates.
3. **Starting with a feature counts as the first reply.** `workflow_advance({ to: 1, feature })` with a non-empty `feature` creates the run with `humanSeq = 1`, so Claude can leave step 1 without asking again when `/stWorkflow <feature>` already said enough.
4. **Waiting vs. thinking at a gate.** The rail shows `◈` + hint only while the gate is waiting (`humanSeq <= gateSeq`). Once the human has replied it shows `◉` (Claude is processing the reply).
5. **Finished runs.** At step 15 the rail shows `✔ done` until the next human prompt, which clears the run.
6. **Merge finishes the run.** When the watcher sees the PR merged it moves the run 14 → 15 itself.
7. **Units are pure files.** The spec's `tool`/`compose`/`watch` units are split into pure logic files plus wiring in `register.tsx` (required by the `$` rule above).

## Review Focus

Inputs the spec implies but doesn't spell out, most likely first. Each has a test in the task named.

1. **Prompts the human didn't type** (task notifications, plugin- or SDK-sent prompts) must not satisfy a gate. → Task 5, `tool.test.ts` "non-human prompts do not open a gate".
2. **Malformed tool input from Claude** (`to: "5"`, `to: 4.5`, `to: 0`, missing `verdict`, `pr` without `url`) must be refused with a message naming what's legal, never thrown. → Task 1, `machine.test.ts` "rejects malformed targets".
3. **Long text on a narrow terminal** (long alert, PR part, 60-column body) must drop parts, never wrap the rail onto two lines. → Task 2, `rail.test.ts` "drops PR then activity when narrow".
4. **`gh` exits 0 but prints non-JSON or partial JSON** must count as a failed poll and back off, not crash or alert spuriously. → Task 3, `watch.test.ts` "parseGh rejects garbage", and Task 5 "garbage output counts as a failure".
5. **Restart or hot reload during step 14** must resume polling exactly once, without duplicate timers or duplicate alerts. → Task 5, `watch-flow.test.ts` "a second session.start does not double-poll".

---

## File Structure

```
stworkflow/
├── .claude-plugin/
│   └── plugin.json            # manifest; "types": "./types/index.d.ts"
├── hooks/
│   ├── hooks.json             # { "modules": ["./register.tsx"] }
│   ├── register.tsx           # ONLY file that uses $ — event wiring, timers, persistence
│   ├── machine.ts             # pure: steps, edges, advance(), gate guard, counters
│   ├── store.ts               # pure: store key, parse/validate stored run
│   ├── compose.ts             # pure: per-step guide text, /stWorkflow-status text
│   ├── rail.tsx               # pure: railParts() model + drawRail() tree
│   └── watch.ts               # pure: gh JSON → Pr, diff → events, backoff
├── skills/stWorkflow/SKILL.md # the playbook
├── types/index.d.ts           # Run/Pr/StepNo types + PluginState contract
├── tests/
│   ├── helpers.ts             # engine stubs + driveTo() for integration tests
│   ├── machine.test.ts
│   ├── store-compose.test.ts
│   ├── rail.test.tsx
│   ├── watch.test.ts
│   ├── tool.test.ts
│   └── watch-flow.test.ts
├── tsconfig.json
├── .gitignore                 # .claude-plugin/types/
└── README.md
```

Commands used throughout (run from `~/projects/stworkflow`):

- Tests: `claude plugin test .`
- Validate: `claude plugin validate .`
- Type-check: `npx -y -p typescript@5 tsc -p .`

---

### Task 1: Scaffold, types and the state machine

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` (placeholder), `types/index.d.ts`, `tsconfig.json`, `.gitignore`, `hooks/machine.ts`, `hooks/store.ts`
- Test: `tests/machine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types/index.d.ts`: `StepNo`, `Verdict`, `CheckState`, `Pr`, `Run`, and `PluginState['stworkflow'] = { run: Run | null }`.
  - `hooks/machine.ts`: `type Phase`, `type Kind`, `STEPS: Record<StepNo, { name: string; phase: Phase; kind: Kind }>`, `EDGES: Record<StepNo, readonly StepNo[]>`, `isStep(n: unknown): n is StepNo`, `isHumanStep(run: Run): boolean`, `isWaitingOnHuman(run: Run): boolean`, `totalLoops(run: Run): number`, `newRun(o: { id: string; feature: string; now: number }): Run`, `noteHuman(run: Run): Run`, `type AdvanceInput = { to: unknown; verdict?: unknown; pr?: unknown; now: number }`, `type AdvanceResult = { ok: true; run: Run } | { ok: false; error: string }`, `advance(run: Run, input: AdvanceInput): AdvanceResult`.
  - `hooks/store.ts`: `storeKey(root: string): string`, `parseRun(v: unknown): { run: Run | null; discarded: boolean }`.

- [ ] **Step 1: Create the scaffold files**

`.claude-plugin/plugin.json`:

```json
{
  "name": "stworkflow",
  "version": "0.1.0",
  "description": "Runs a feature from idea to merged PR through a 15-step workflow, shown as a one-line rail above the prompt",
  "types": "./types/index.d.ts"
}
```

`hooks/hooks.json`:

```json
{ "modules": ["./register.tsx"] }
```

`hooks/register.tsx` (placeholder; Task 4 replaces it):

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

`types/index.d.ts`:

```ts
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
  history: { at: number; step: StepNo; text: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    stworkflow: { run: Run | null }
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

`.gitignore`:

```
.claude-plugin/types/
```

- [ ] **Step 2: Put the API declarations where `tsc` finds them**

Claude Code writes `.claude-plugin/types/` itself whenever it loads the mod. Until then, copy this build's declarations in:

```bash
mkdir -p .claude-plugin/types/claude-code
cp /tmp/claude-1000/bundled-skills/2.1.290/d1a12c04205df4c3bcf05c6e221f2d78/plugin-authoring/types/claude-code.d.ts .claude-plugin/types/claude-code/index.d.ts
```

If that path no longer exists (new session), load the skill with `/plugin-authoring`; its text names the current path. Use that one.

- [ ] **Step 3: Write the failing machine tests**

`tests/machine.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL; the test file cannot import `../hooks/machine` (module not found).

- [ ] **Step 5: Write `hooks/machine.ts`**

```ts
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
    const pr = parsePrRef(input.pr)
    if (!pr) return { ok: false, error: 'Moving to step 13 needs pr: { number, url } for the draft PR you opened.' }
    next.pr = { number: pr.number, url: pr.url, state: 'draft', checks: [], review: 'none', comments: 0 }
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
```

Note: the `history` test expects `'plan → plan critic'` for 2 → 3 (no verdict, so no tail).

- [ ] **Step 6: Write `hooks/store.ts`**

```ts
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS, all tests in `tests/machine.test.ts`.

- [ ] **Step 8: Validate and type-check**

Run: `claude plugin validate .` → Expected: `✔ Validation passed` (the missing-author warning is fine).
Run: `npx -y -p typescript@5 tsc -p .` → Expected: no output, exit 0.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin/plugin.json hooks types tests tsconfig.json .gitignore
git commit -m "feat: scaffold plugin and workflow state machine"
```

---

### Task 2: The rail (pure model and drawing)

**Files:**
- Create: `hooks/rail.tsx`
- Test: `tests/rail.test.tsx` (pure part; Task 5 adds the mounted tests)

**Interfaces:**
- Consumes: `STEPS`, `isWaitingOnHuman`, `totalLoops`, `type Phase` from `hooks/machine.ts`; `Run` from `types`.
- Produces: `COLORS`, `type RailPart = { key: string; text: string; group: 'core' | 'activity' | 'pr'; color?: string; dim?: boolean; bold?: boolean; href?: string }`, `type RailInput = { run: Run; columns: number; frame: number; isWorking: boolean }`, `hintFor(run: Run): string`, `railParts(i: RailInput): RailPart[]`, `railText(parts: readonly RailPart[]): string`, `type RailEls`, `drawRail(els: RailEls, parts: readonly RailPart[])`.

- [ ] **Step 1: Write the failing tests**

`tests/rail.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'

import type { Run } from '../types'
import { newRun, noteHuman } from '../hooks/machine'
import { railParts, railText } from '../hooks/rail'

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
```

Width arithmetic for the `drops PR then activity` cases: the rail is 14 two-char cells + the 1-char head + 3 `┃` = 32; the core adds 8 (`  14/15 `) + 11 (`watching PR`) = 51. At 85 columns the activity `' ⚑ e2e failed · reply fix it'` (28) makes 79 ≤ 85, and the PR part (` │ #128 ✔` = 9) would make 88 > 85, so only PR goes. At 60 columns core plus activity is 79 > 60, so activity goes too; core alone is 51 ≤ 60.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL; `../hooks/rail` not found.

- [ ] **Step 3: Write `hooks/rail.tsx`**

```tsx
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
```

Check against the tests: in the `PR part` test the checks render as `✔✖○` straight after `#128 `, and `running` uses the spinner frame (`⠋` at frame 0). In `skipped PR steps and done`, step 12 is done (`━━`), 13–14 skipped (`┄┄┄┄`), 15 done (`━━`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS for `tests/rail.test.tsx` and `tests/machine.test.ts`.

- [ ] **Step 5: Type-check**

Run: `npx -y -p typescript@5 tsc -p .`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add hooks/rail.tsx tests/rail.test.tsx
git commit -m "feat: rail model and drawing"
```

---

### Task 3: Guide text, status text and the PR watcher logic (pure)

**Files:**
- Create: `hooks/compose.ts`, `hooks/watch.ts`
- Test: `tests/store-compose.test.ts`, `tests/watch.test.ts`

**Interfaces:**
- Consumes: `STEPS`, `EDGES`, `isWaitingOnHuman`, `totalLoops` from `machine.ts`; `storeKey`, `parseRun` from `store.ts`; `Run`, `Pr`, `CheckState`, `StepNo` from `types`.
- Produces:
  - `compose.ts`: `GUIDE: Record<StepNo, string>`, `stepGuide(run: Run): string`, `statusText(run: Run | null): string`.
  - `watch.ts`: `GH_FIELDS: string`, `FIRST_POLL_MS = 5000`, `nextDelay(failures: number): number`, `checkState(c: Record<string, unknown>): CheckState`, `parseGh(stdout: string): Pr | null`, `type PrEvent = { text: string; alert?: string }`, `diffPr(prev: Pr, next: Pr): PrEvent[]`.

- [ ] **Step 1: Write the failing tests**

`tests/store-compose.test.ts`:

```ts
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
```

`tests/watch.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { checkState, diffPr, nextDelay, parseGh } from '../hooks/watch'

const pr = (patch: Partial<Pr> = {}): Pr => ({
  number: 128, url: 'https://github.com/acme/web/pull/128', state: 'ready', review: 'none', comments: 0, checks: [], ...patch,
})

test('backoff schedule', async () => {
  expect([0, 1, 2, 3, 9].map(nextDelay)).toEqual([60_000, 60_000, 120_000, 300_000, 300_000])
})

test('check states from check runs and status contexts', async () => {
  expect(checkState({ status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe('pass')
  expect(checkState({ status: 'COMPLETED', conclusion: 'SKIPPED' })).toBe('pass')
  expect(checkState({ status: 'COMPLETED', conclusion: 'FAILURE' })).toBe('fail')
  expect(checkState({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('fail')
  expect(checkState({ status: 'IN_PROGRESS', conclusion: '' })).toBe('running')
  expect(checkState({ status: 'QUEUED' })).toBe('queued')
  expect(checkState({ state: 'SUCCESS' })).toBe('pass')
  expect(checkState({ state: 'ERROR' })).toBe('fail')
  expect(checkState({ state: 'PENDING' })).toBe('running')
})

test('parseGh maps gh JSON', async () => {
  const out = JSON.stringify({
    number: 128, url: 'https://github.com/acme/web/pull/128', state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }, { context: 'ci/e2e', state: 'PENDING' }],
    comments: [{}, {}],
  })
  expect(parseGh(out)).toEqual(pr({ review: 'changes', comments: 2, checks: [{ name: 'lint', state: 'pass' }, { name: 'ci/e2e', state: 'running' }] }))
  expect(parseGh(JSON.stringify({ number: 128, url: 'https://x/1', state: 'MERGED', isDraft: false, reviewDecision: null, statusCheckRollup: null, comments: [] }))?.state).toBe('merged')
})

test('parseGh rejects garbage', async () => {
  expect(parseGh('')).toBe(null)
  expect(parseGh('not json')).toBe(null)
  expect(parseGh('{"number": 128}')).toBe(null)
  expect(parseGh('[1,2]')).toBe(null)
})

test('diffPr reports each change once', async () => {
  const before = pr({ checks: [{ name: 'e2e', state: 'running' }] })
  expect(diffPr(before, before)).toEqual([])
  expect(diffPr(before, pr({ checks: [{ name: 'e2e', state: 'fail' }] }))).toEqual([{ text: 'PR #128: CI failed on e2e', alert: 'e2e failed' }])
  expect(diffPr(before, pr({ checks: [{ name: 'e2e', state: 'pass' }] }))).toEqual([{ text: 'PR #128: all checks passed' }])
  expect(diffPr(before, pr({ checks: before.checks, review: 'approved' }))).toEqual([{ text: 'PR #128 was approved' }])
  expect(diffPr(before, pr({ checks: before.checks, review: 'changes' }))).toEqual([{ text: 'PR #128: changes requested', alert: 'changes requested' }])
  expect(diffPr(before, pr({ checks: before.checks, comments: 2 }))).toEqual([{ text: 'PR #128: 2 new comments', alert: 'new comment' }])
  expect(diffPr(before, pr({ checks: before.checks, state: 'merged' }))).toEqual([{ text: 'PR #128 was merged' }])
  expect(diffPr(before, pr({ checks: before.checks, state: 'closed' }))).toEqual([{ text: 'PR #128 was closed without merging', alert: 'PR closed' }])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL; `../hooks/compose` and `../hooks/watch` not found.

- [ ] **Step 3: Write `hooks/compose.ts`**

```ts
import type { Run, StepNo } from '../types'
import { EDGES, STEPS, isWaitingOnHuman, totalLoops } from './machine'

export const GUIDE: Readonly<Record<StepNo, string>> = {
  1: 'Make sure the feature request is specific enough to plan. If it is vague, ask the human focused follow-up questions and wait for the answers. When it is clear, advance to 2.',
  2: 'Write the plan with the superpowers:brainstorming skill and save it under docs/superpowers/specs/. On a revision, address every point the human and the plan critic raised. Then advance to 3.',
  3: 'Spawn a fresh subagent as the adversarial PLAN critic. Give it the plan path; tell it to hunt for gaps, risks, unstated assumptions and scope problems, and to answer with a verdict (pass or block) and findings marked blocker, major or nit. Then advance to 4 with verdict.',
  4: "Post the plan path and the plan critic's findings in chat, then ask the human to approve or say what to change. Wait for their reply, then advance to 5.",
  5: 'If the human asked for changes, or the critic blocked and the human did not explicitly override it, advance to 2. If the human approved, advance to 6.',
  6: 'Write the detailed implementation spec with the superpowers:writing-plans skill and save it under docs/superpowers/plans/. Then advance to 7.',
  7: 'Spawn a NEW subagent, not the plan critic, as the adversarial SPEC critic. Give it the spec and plan paths; tell it to check task order, missing tests, vague steps and mismatches with the plan, and to answer with a verdict (pass or block) and findings marked blocker, major or nit. Then advance to 8 with verdict.',
  8: "Post the spec path and the spec critic's findings in chat, then ask the human to approve or say what to change. Wait for their reply, then advance to 9.",
  9: 'If the human asked for changes, or the critic blocked and the human did not explicitly override it, correct the spec now and then advance to 7. If the human approved, advance to 10.',
  10: 'Implement the spec with the superpowers:subagent-driven-development skill. When you come back here from a review or the PR, fix exactly what was reported. Then advance to 11.',
  11: 'Review the code with the superpowers:requesting-code-review skill, as an adversarial reviewer. If it finds problems, advance to 10 with verdict "block". If it is clean, advance to 12 with verdict "pass".',
  12: 'Check for a GitHub remote (git remote -v) and a working gh (gh auth status). If either is missing, tell the human and advance to 15. Otherwise push the branch, run gh pr create --draft with a human-readable title and a description that explains what changed and why, then advance to 13 with pr: { number, url }.',
  13: 'Give the human the PR link and ask them to review it. Wait for their reply. If they approve, run gh pr ready <number> and advance to 14. If they ask for fixes, advance to 10.',
  14: 'The stWorkflow mod is watching the PR and alerts the human about CI, reviews and comments. Do nothing unless the human asks. If they ask you to fix something, advance to 10. When the PR is merged the mod finishes the run.',
  15: 'The run is complete. Summarise the outcome if the human asks.',
}

export function stepGuide(run: Run): string {
  const legal = EDGES[run.step].map(n => `${n} (${STEPS[n].name})`).join(', ')
  const lines = [
    `stWorkflow run: "${run.feature}". Current step ${run.step}/15: ${STEPS[run.step].name}.`,
    GUIDE[run.step],
  ]
  if (isWaitingOnHuman(run)) lines.push("This is the human's turn: do not call workflow_advance until they have replied.")
  if (legal) lines.push(`Legal next steps: ${legal}. Report every step change with the workflow_advance tool.`)
  return lines.join('\n')
}

export function statusText(run: Run | null): string {
  if (!run) return 'No stWorkflow run is active.'
  const loops = totalLoops(run)
  const lines = [
    `stWorkflow · ${run.feature || '(no feature yet)'}`,
    `Step ${run.step}/15 · ${STEPS[run.step].name} · ${loops} revision loop${loops === 1 ? '' : 's'}`,
  ]
  if (run.pr) lines.push(`PR #${run.pr.number} (${run.pr.state}) ${run.pr.url}`)
  if (run.alert) lines.push(`Alert: ${run.alert}`)
  lines.push('History:')
  for (const h of run.history) {
    const minutes = Math.round((h.at - run.startedAt) / 60_000)
    lines.push(`  +${minutes}m  ${h.step}  ${h.text}`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Write `hooks/watch.ts`**

```ts
import type { CheckState, Pr } from '../types'

export const GH_FIELDS = 'number,url,state,isDraft,reviewDecision,statusCheckRollup,comments'
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
  const review: Pr['review'] =
    o.reviewDecision === 'APPROVED' ? 'approved' : o.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : 'none'
  const rollup = Array.isArray(o.statusCheckRollup) ? (o.statusCheckRollup as Record<string, unknown>[]) : []
  const checks = rollup.map(c => ({ name: String(c.name ?? c.context ?? 'check'), state: checkState(c) }))
  const comments = Array.isArray(o.comments) ? o.comments.length : 0
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS for all four test files.

- [ ] **Step 6: Type-check**

Run: `npx -y -p typescript@5 tsc -p .`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add hooks/compose.ts hooks/watch.ts tests/store-compose.test.ts tests/watch.test.ts
git commit -m "feat: step guide, status text and PR diff logic"
```

---

### Task 4: Wire it up in `register.tsx`

**Files:**
- Modify: `hooks/register.tsx` (replace the placeholder entirely)

**Interfaces:**
- Consumes: everything produced by Tasks 1–3, exactly as named there.
- Produces (for Task 5 tests and the skill): tool `mcp__stworkflow__workflow_advance` with input `{ to: integer 1–15, feature?: string, verdict?: 'pass' | 'block', pr?: { number: integer, url: string } }`; successful results are `{ result: string }` starting `Run started.` or `Now at step N/15 (name).`; refusals are `{ deny: string }`. Commands `stWorkflow-status` and `stWorkflow-abort` answer `{ text }`. A rail on `AbovePrompt`. Toasts: `stWorkflow: your turn · <step name>` on entering a waiting gate, `stWorkflow: run complete.` on entering 15, each PR event's `text`, and `stWorkflow: can't reach GitHub: <reason>`. Transcript lines (`$.ui.log`): `⚑ <event text>`, `⚑ can't reach GitHub: <reason>`, `stWorkflow: discarded a saved run from an older version.`

This task has no tests of its own; Task 5 is its test task, and the work is split so a reviewer can judge the wiring and its coverage separately.

- [ ] **Step 1: Write `hooks/register.tsx`**

```tsx
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
  'Moving from 12 to 13 needs pr: { number, url } for the draft PR.',
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
      description: 'The draft PR, when moving from 12 to 13',
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
  isActive = next !== null
  await update($, run, () => next)
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

  if (!fresh) {
    const failures = current.ghFailures + 1
    if (failures === 3) {
      const reason = (res.stderr.split('\n')[0] || 'gh returned output stWorkflow could not read').slice(0, 120)
      $.ui.toast(`stWorkflow: can't reach GitHub: ${reason}`)
      $.ui.log(`⚑ can't reach GitHub: ${reason}`)
    }
    await save($, { ...current, ghFailures: failures })
    scheduleWatch($, nextDelay(failures))
    return
  }

  const events = diffPr(current.pr, fresh)
  for (const ev of events) {
    $.ui.toast(ev.text)
    $.ui.log(`⚑ ${ev.text}`)
  }
  const alert = [...events].reverse().find(ev => ev.alert)?.alert
  let next: Run = { ...current, pr: fresh, ghFailures: 0 }
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
  })

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
  })

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
  })

  on('command.run', { command: 'stWorkflow-status' }, async $ => ({ text: statusText(await read($, run)) }))

  on('command.run', { command: 'stWorkflow-abort' }, async $ => {
    const current = await read($, run)
    if (!current) return { text: 'No stWorkflow run is active.' }
    stopWatch()
    await save($, null)
    return { text: `Abandoned the run "${current.feature}" at step ${current.step}/15.` }
  })
}
```

- [ ] **Step 2: Validate**

Run: `claude plugin validate .`
Expected: `✔ Validation passed` (warnings allowed). The `hooks:` line lists `session.start, prompt.submit, turn.start, tool.call{tool=mcp__stworkflow__workflow_advance}, prompt.compose, ui.render{component=AbovePrompt}, command.run{command=stWorkflow-status}, command.run{command=stWorkflow-abort}`. The `state reads:` and `state writes:` lines name `stworkflow.run`. If validation reports `$... is used as a value` or `passed to an imported function`, a `$` call has leaked out of `register.tsx`; move it back.

- [ ] **Step 3: Type-check**

Run: `npx -y -p typescript@5 tsc -p .`
Expected: no output. If `e.to`/`e.feature`/`e.verdict`/`e.pr` are reported as not existing on the event type, the tool's typed input isn't generated yet: change the reads to `(e as Record<string, unknown>).to` (and likewise for the other three) and re-run.

- [ ] **Step 4: Run the existing tests**

Run: `claude plugin test .`
Expected: PASS (Tasks 1–3 tests still green).

- [ ] **Step 5: Commit**

```bash
git add hooks/register.tsx
git commit -m "feat: wire tool, gates, persistence, rail and PR watcher"
```

---

### Task 5: Integration tests through the engine

**Files:**
- Create: `tests/helpers.ts`, `tests/tool.test.ts`, `tests/watch-flow.test.ts`
- Modify: `tests/rail.test.tsx` (append the mounted tests)

**Interfaces:**
- Consumes: the behaviour listed under Task 4 "Produces".
- Produces: `tests/helpers.ts` exports `TOOL`, `GOOD_PR`, `stubEngine(on, gh?, seed?)`, `start($)`, `say($, text, kind?)`, `adv($, input)`, `status($)`, `driveTo($, target)`.

Test-kit facts these helpers rely on (verified against Claude Code 2.1.290):
- Engine operations the mod calls must be answered by the test with `{ value }`: `session.root`, `tool.register`, `command.register`, `ui.invalidate`, `ui.toast`, `ui.log`, `process.run`.
- Events the mod passes on with `next(e)` must be answered with the event's result: `session.start` → `{ cwd }`, `prompt.submit` → `{ text }`, `turn.start` → `{ turnId }`.
- `mock.store(on)` and `mock.clock(on)` stand in for `$.store` and `$.clock`. The test's `$` has no `store` noun, so check persistence through a second `session.start` or a pre-seeded `mock.store(on, { ... })`.

- [ ] **Step 1: Write `tests/helpers.ts`**

```ts
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const TOOL = 'mcp__stworkflow__workflow_advance'
export const GOOD_PR = { number: 128, url: 'https://github.com/acme/web/pull/128' }

type GhReply = { exitCode: number; stdout: string; stderr: string }

export function stubEngine(
  on: On,
  gh: (argv: readonly string[]) => GhReply = () => ({ exitCode: 1, stdout: '', stderr: 'gh: not stubbed' }),
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
  on('process.run', (_$, e) => {
    calls.gh.push([...e.argv])
    return { value: { ...gh(e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
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

export async function status($: Engine): Promise<string> {
  return (await $.command.run({ command: 'stWorkflow-status' })).text ?? ''
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
```

- [ ] **Step 2: Write `tests/tool.test.ts`**

```ts
import { expect, test } from 'claude-code/testing'

import { adv, driveTo, GOOD_PR, say, start, status, stubEngine } from './helpers'

test('starting a run returns the step guide and shows the run', async ($, on) => {
  stubEngine(on)
  await start($)
  const r = await adv($, { to: 1, feature: 'Add dark mode toggle to Settings' })
  expect(String(r.result)).toContain('Run started.')
  expect(String(r.result)).toContain('Current step 1/15: input.')
  expect(await status($)).toContain('Step 1/15 · input')
})

test('a second start while a run is active is refused', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  const r = await adv($, { to: 1, feature: 'Something else' })
  expect(r.deny).toContain('A run is already active: "Add dark mode toggle to Settings" at step 2/15 (plan).')
})

test('moves without a run are refused', async ($, on) => {
  stubEngine(on)
  await start($)
  expect((await adv($, { to: 2 })).deny).toContain('No stWorkflow run is active.')
})

test('illegal moves are refused with the legal ones', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  expect((await adv($, { to: 6 })).deny).toBe('Illegal move 2 → 6. From step 2 (plan) you can go to: 3 (plan critic).')
})

test('a gate opens only after the human replies', async ($, on) => {
  const calls = stubEngine(on)
  await start($)
  await driveTo($, 3)
  await adv($, { to: 4, verdict: 'pass' })
  expect(calls.toasts).toContain('stWorkflow: your turn · plan review')
  expect((await adv($, { to: 5 })).deny).toContain("hasn't replied")
  await say($, 'looks good, approve')
  expect((await adv($, { to: 5 })).result).toBeDefined()
})

test('non-human prompts do not open a gate', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 4)
  await say($, 'background task finished', 'task-notification')
  expect((await adv($, { to: 5 })).deny).toContain("hasn't replied")
})

test('a saved run is restored on session start', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 6)
  await start($)
  expect(await status($)).toContain('Step 6/15 · spec')
})

test('a saved run from another version is discarded with a note', async ($, on) => {
  const calls = stubEngine(on, undefined, { 'run:/repo': { version: 0, step: 3 } })
  await start($)
  expect(await status($)).toBe('No stWorkflow run is active.')
  expect(calls.logs).toContain('stWorkflow: discarded a saved run from an older version.')
})

test('abort ends the run', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 2)
  const r = await $.command.run({ command: 'stWorkflow-abort' })
  expect(r.text).toBe('Abandoned the run "Add dark mode toggle to Settings" at step 2/15.')
  expect(await status($)).toBe('No stWorkflow run is active.')
})

test('no repo: 12 → 15, then the next prompt clears the finished run', async ($, on) => {
  const calls = stubEngine(on)
  await start($)
  await driveTo($, 12)
  await adv($, { to: 15 })
  expect(calls.toasts).toContain('stWorkflow: run complete.')
  expect(await status($)).toContain('Step 15/15 · done')
  await say($, 'thanks')
  expect(await status($)).toBe('No stWorkflow run is active.')
})

test('PR gate: fixes go back to build and count as a ship loop', async ($, on) => {
  stubEngine(on)
  await start($)
  await driveTo($, 13)
  await say($, 'rename the setting to Appearance')
  await adv($, { to: 10 })
  expect(await status($)).toContain('Step 10/15 · build · 1 revision loop')
  expect(await status($)).toContain(`PR #${GOOD_PR.number} (draft)`)
})
```


- [ ] **Step 3: Write `tests/watch-flow.test.ts`**

```ts
import { expect, test } from 'claude-code/testing'

import { driveTo, start, status, stubEngine } from './helpers'

const gh = (patch: Record<string, unknown>) => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify({
    number: 128, url: 'https://github.com/acme/web/pull/128', state: 'OPEN', isDraft: false, reviewDecision: '',
    statusCheckRollup: [{ name: 'e2e', status: 'IN_PROGRESS', conclusion: '' }], comments: [], ...patch,
  }),
})

test('polls after entering 14, alerts on changes, finishes on merge', async ($, on) => {
  const replies = [
    gh({}),
    gh({ statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
    gh({ state: 'MERGED', statusCheckRollup: [{ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
  ]
  const calls = stubEngine(on, () => replies.shift() ?? gh({ state: 'MERGED' }))
  await start($)
  await driveTo($, 14)

  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(1)
  expect(calls.gh[0]).toEqual(['gh', 'pr', 'view', '128', '--json', 'number,url,state,isDraft,reviewDecision,statusCheckRollup,comments'])

  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.toasts).toContain('PR #128: CI failed on e2e')
  expect(calls.logs).toContain('⚑ PR #128: CI failed on e2e')
  expect(await status($)).toContain('Alert: e2e failed')

  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.toasts).toContain('PR #128 was merged')
  expect(calls.toasts).toContain('stWorkflow: run complete.')
  expect(await status($)).toContain('Step 15/15 · done')

  await calls.clock.advance(600_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(3)
})

test('backs off and warns once when GitHub is unreachable', async ($, on) => {
  const calls = stubEngine(on, () => ({ exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' }))
  await start($)
  await driveTo($, 14)
  for (const ms of [5_000, 60_000, 120_000]) {
    await calls.clock.advance(ms)
    await calls.clock.settle()
  }
  expect(calls.gh.length).toBe(3)
  expect(calls.toasts.filter(t => t.includes("can't reach GitHub"))).toEqual(["stWorkflow: can't reach GitHub: error connecting to api.github.com"])
  await calls.clock.advance(299_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(3)
  await calls.clock.advance(1_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(4)
  expect(calls.toasts.filter(t => t.includes("can't reach GitHub")).length).toBe(1)
})

test('garbage output counts as a failure', async ($, on) => {
  const calls = stubEngine(on, () => ({ exitCode: 0, stdout: '<html>rate limited</html>', stderr: '' }))
  await start($)
  await driveTo($, 14)
  for (const ms of [5_000, 60_000, 120_000]) {
    await calls.clock.advance(ms)
    await calls.clock.settle()
  }
  expect(calls.toasts).toContain("stWorkflow: can't reach GitHub: gh returned output stWorkflow could not read")
  expect(calls.logs.filter(l => l.startsWith('⚑ PR'))).toEqual([])
})

test('a second session.start does not double-poll', async ($, on) => {
  const calls = stubEngine(on, () => gh({}))
  await start($)
  await driveTo($, 14)
  await start($)
  await calls.clock.advance(5_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(1)
  await calls.clock.advance(60_000)
  await calls.clock.settle()
  expect(calls.gh.length).toBe(2)
})
```

- [ ] **Step 4: Append mounted rail tests to `tests/rail.test.tsx`**

Add these imports at the top of `tests/rail.test.tsx` (next to the existing ones):

```tsx
import { driveTo, start, stubEngine } from './helpers'
```

Append at the end of the file:

```tsx
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
```

- [ ] **Step 5: Run the whole suite**

Run: `claude plugin test .`
Expected: PASS, every test in all six files.

If a failure says `nothing beneath the plugins answers <name>`, add a stub for `<name>` in `stubEngine`: `{ value: ... }` for an engine operation, or the event's result object for an event. If a test's assertion fails, fix `register.tsx` or the pure module it points at; don't loosen the assertion.

- [ ] **Step 6: Type-check and validate**

Run: `npx -y -p typescript@5 tsc -p .` → no output.
Run: `claude plugin validate .` → `✔ Validation passed`.

- [ ] **Step 7: Commit**

```bash
git add tests
git commit -m "test: engine-level tests for tool, gates, rail and PR watcher"
```

---

### Task 6: The skill, the README, and an end-to-end check

**Files:**
- Create: `skills/stWorkflow/SKILL.md`, `README.md`

**Interfaces:**
- Consumes: tool `workflow_advance` (`mcp__stworkflow__workflow_advance`) and its input shape; commands `/stWorkflow-status`, `/stWorkflow-abort`.
- Produces: the `/stWorkflow` entry point.

- [ ] **Step 1: Write `skills/stWorkflow/SKILL.md`**

````markdown
---
name: stWorkflow
description: Run a feature from idea to merged PR through the 15-step stWorkflow (plan, adversarial review, human approval, spec, review, approval, build, code review, draft PR, PR review, watch). Use when the user invokes /stWorkflow or asks to start, resume or continue an stWorkflow run.
---

# stWorkflow

You are running a feature through a fixed 15-step workflow. The stworkflow mod
tracks the run, shows it on a rail above the prompt, and refuses moves that skip
steps or pass a human gate without the human's reply.

## The one rule

Report every step change with the `workflow_advance` tool
(`mcp__stworkflow__workflow_advance`). Never describe a step as done without
reporting it. If the tool refuses a move, read its message, do what it says, and
don't retry the same move until that's done.

## Starting

1. Call `workflow_advance({ to: 1, feature: "<one-line summary of what the user asked for>" })`.
   Use the user's words from the `/stWorkflow` arguments. If there were none,
   omit `feature`.
2. If the tool says a run is already active, tell the user which run and step,
   and ask whether to resume it or abandon it. To resume, carry on from the
   current step as the tool's guide describes. To abandon, ask the user to run
   `/stWorkflow-abort`, then start again.
3. The tool's answer includes the current step's instructions. So does your
   system prompt on every turn. Follow them.

## The steps

| # | Step | What you do | Then |
|---|---|---|---|
| 1 | Input | If the request is vague, ask focused follow-up questions and wait. | `to: 2` |
| 2 | Plan | Use the `superpowers:brainstorming` skill; save under `docs/superpowers/specs/`. On a revision, address every point raised. | `to: 3` |
| 3 | Plan critic | Spawn a fresh subagent as an adversarial **plan** critic (brief below). | `to: 4, verdict` |
| 4 | Plan review | Post the plan path and the critic's findings. Ask the user to approve or say what to change. Wait. | `to: 5` |
| 5 | Route | Changes requested, or critic blocked without an explicit override → `to: 2`. Approved → `to: 6`. | |
| 6 | Spec | Use the `superpowers:writing-plans` skill; save under `docs/superpowers/plans/`. | `to: 7` |
| 7 | Spec critic | Spawn a **new** subagent (not the plan critic) as an adversarial **spec** critic (brief below). | `to: 8, verdict` |
| 8 | Spec review | Post the spec path and the critic's findings. Ask the user to approve or say what to change. Wait. | `to: 9` |
| 9 | Route | Changes or unresolved block → correct the spec, then `to: 7`. Approved → `to: 10`. | |
| 10 | Build | Use the `superpowers:subagent-driven-development` skill. On a return, fix exactly what was reported. | `to: 11` |
| 11 | Code critic | Use the `superpowers:requesting-code-review` skill as an adversarial review. | problems → `to: 10, verdict: "block"`; clean → `to: 12, verdict: "pass"` |
| 12 | Draft PR | Check `git remote -v` and `gh auth status`. Missing either → tell the user, `to: 15`. Otherwise push and `gh pr create --draft` with a human-readable title and a description of what changed and why. | `to: 13, pr: { number, url }` |
| 13 | PR review | Give the user the PR link; ask them to review. Wait. Approved → `gh pr ready <number>`, `to: 14`. Fixes → `to: 10`. | |
| 14 | Watch | The mod polls the PR and alerts the user. Do nothing unless asked. Asked to fix something → `to: 10`. The mod finishes the run on merge. | |
| 15 | End | Summarise if asked. | |

## Human gates (steps 1, 4, 8, 13)

- Ask, then stop and wait. The tool refuses to leave a gate until the user has
  sent a message after it opened.
- Read the user's reply as natural language. "Looks good" is approval. "Looks
  good but rename X" is a change request. When a reply is truly ambiguous, ask.
- If the critic blocked, recommend revising. Only treat "approve" as overriding
  the critic when the user clearly means it.

## Critic briefs

**Plan critic (step 3).** "You are an adversarial reviewer. Read <plan path>.
Find gaps, risks, unstated assumptions, scope creep and missing success
criteria. Answer with `VERDICT: pass` or `VERDICT: block`, then findings, each
marked `blocker`, `major` or `nit`. Block only for blockers."

**Spec critic (step 7).** "You are an adversarial reviewer who has not seen the
earlier review. Read <spec path> and <plan path>. Check task order and
dependencies, missing or weak tests, vague steps, placeholders, and anything
that contradicts the plan. Answer with `VERDICT: pass` or `VERDICT: block`,
then findings marked `blocker`, `major` or `nit`. Block only for blockers."

Pass the critic's verdict to `workflow_advance` as `verdict`.

## While the PR is watched

The mod posts ⚑ lines in the transcript when CI fails, a reviewer comments,
requests changes or approves, or the PR is merged. If the user replies "fix it"
or asks for a change, move `to: 10` and address it.

## Useful commands for the user

- `/stWorkflow-status`: the run's step, loops, PR and history.
- `/stWorkflow-abort`: abandon the run.
````

- [ ] **Step 2: Write `README.md`**

````markdown
# stWorkflow

A Claude Code plugin that runs a feature from idea to merged PR through a
15-step workflow, with adversarial reviews and human approval gates, and shows
progress as a single line above the prompt:

```
━━━━━━━━━━┃━━━━━━━━┃◉──┃────────  10/15 build ⠹ ↺1 │ #128 ✔✔⠋
```

Tested with Claude Code 2.1.290.

## Requirements

- Claude Code 2.1.287 or later (mods enabled)
- The `superpowers` plugin (brainstorming, writing-plans, subagent-driven-development, requesting-code-review)
- `gh`, authenticated, for the PR steps (optional; without it the run ends after code review)

## Use

```bash
claude --plugin-dir ~/projects/stworkflow
```

Then, in the session:

- `/stWorkflow add a dark mode toggle to Settings` starts a run.
- Reply in chat at each gate: approve, or say what to change.
- `/stWorkflow-status` shows the run; `/stWorkflow-abort` abandons it.

## Develop

```bash
claude plugin test .
claude plugin validate .
npx -y -p typescript@5 tsc -p .
```

`hooks/register.tsx` is the only file that uses the mods API. Everything else in
`hooks/` is pure and unit-tested.
````

- [ ] **Step 3: Final checks**

Run: `claude plugin validate .` → `✔ Validation passed`; the output also lists the skill.
Run: `claude plugin test .` → all PASS.
Run: `npx -y -p typescript@5 tsc -p .` → no output.

- [ ] **Step 4: Commit**

```bash
git add skills README.md
git commit -m "feat: stWorkflow skill playbook and README"
```

- [ ] **Step 5: Manual end-to-end check (human-assisted)**

This step needs a person at a terminal; report the results instead of skipping it.

1. Make a toy repo: `mkdir -p /tmp/stwf-toy && cd /tmp/stwf-toy && git init -q && echo "# toy" > README.md && git add . && git commit -qm init`.
2. Start `claude --plugin-dir ~/projects/stworkflow` there.
3. Run `/stWorkflow add a hello-world script`. Check: the rail appears above the prompt at `1/15`, then moves through 2 → 3 → 4 while Claude works; at 4 the head is `◈` and the hint reads `reply approve or what to change`; a toast says `stWorkflow: your turn · plan review`.
4. Reply `make it print the date too`. Check: the rail goes 5 → 2 and shows `↺1`.
5. Approve through the spec gate. Check: build and code critic run, then step 12 reports no GitHub remote and the rail ends at `15/15 done` with `┄┄┄┄` for the PR steps.
6. Type anything. Check: the rail disappears.
7. Optional, with a scratch GitHub repo: repeat, approve the draft PR at 13 with `ready`, and confirm the PR becomes ready for review, the rail shows `#<n>` and live check marks, and a CI failure produces a toast and a `⚑` line.
````
