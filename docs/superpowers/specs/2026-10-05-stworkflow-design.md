# stWorkflow — Design

**Date:** 2026-10-05
**Status:** Draft for review
**Target:** Claude Code 2.1.290+ (mods / function hooks)

## 1. Purpose

`/stWorkflow` runs a feature from idea to merged PR through a fixed, 15-step
workflow with human approval gates and adversarial reviews, and shows where the
run stands as a single-line "rail" above the prompt. All decisions happen in
chat; the UI is read-only and minimal.

### The workflow

| # | Step | Actor | Uses |
|---|---|---|---|
| 1 | Wait for input; ask follow-ups until the request is substantiated | human | — |
| 2 | Write the plan | Claude | `superpowers:brainstorming` |
| 3 | Adversarial plan review | subagent (plan critic) | — |
| 4 | Human review of the plan | human (gate) | — |
| 5 | Route: changes/problems → 2, approved → 6 | router | — |
| 6 | Write the detailed spec | Claude | `superpowers:writing-plans` |
| 7 | Adversarial spec review (different critic from step 3) | subagent (spec critic) | — |
| 8 | Human review of the spec | human (gate) | — |
| 9 | Route: changes/problems → correct spec → 7, approved → 10 | router | — |
| 10 | Write the code | Claude + subagents | `superpowers:subagent-driven-development` |
| 11 | Adversarial code review; problems → 10, clean → 12 | subagent | `superpowers:requesting-code-review` |
| 12 | If a GitHub repo is attached, open a **draft** PR with a human-readable title and description; otherwise → 15 | Claude | `gh pr create --draft` |
| 13 | Human review of the PR; approved → mark ready (`gh pr ready`) → 14; fixes → 10 | human (gate) | — |
| 14 | Watch CI and reviewers; alert on every change; merged → 15 | mod | `gh pr view` |
| 15 | End | — | — |

### Non-goals

- No buttons, panes or forms. Interaction is chat only.
- The mod does not act on PR events by itself; it alerts. Acting (back to 10)
  happens only when the human says so.
- No support for running two workflows in the same project at once.

## 2. Architecture

One plugin, `stworkflow`, at `~/projects/stworkflow/`, with two halves.

### 2.1 The skill — `skills/stWorkflow/SKILL.md`

Invoked as `/stWorkflow <feature description>`. Holds the playbook in plain
Markdown so it can be edited without touching code:

- The 15 steps, which superpowers skill to load at each, and what "done" means
  for each step.
- How to brief each critic: plan critic (step 3) and spec critic (step 7) are
  separate subagents with fresh context and distinct adversarial prompts; the
  code critic (step 11) goes through `superpowers:requesting-code-review`.
- At a gate, Claude posts the artifact path and the critic's findings as text
  and asks the human to reply.
- The hard rule: every transition is reported with `workflow_advance`.
- The skill's first instruction: call `workflow_advance({ to: 1 })`.

### 2.2 The mod — `hooks/register.ts` and units

| Unit | File | Responsibility |
|---|---|---|
| State machine | `hooks/machine.ts` | Pure. Steps, legal transitions, loop counters, gate guard, skip path. No I/O. |
| Advance tool | `hooks/tool.ts` | Registers `workflow_advance({ to, note? })` → `mcp__stworkflow__workflow_advance`. Validates via the machine; returns the new step's instructions or an error naming the legal next steps. |
| Prompt section | `hooks/compose.ts` | `prompt.compose`: adds a `scope: 'session'` section with the current step, its instructions, and the legal next steps. Absent when no run is active. |
| Rail | `hooks/rail.tsx` | `ui.render` on `{ component: 'AbovePrompt' }`. Draws the one-line rail (section 3). `next(e)` when no run is active. |
| PR watcher | `hooks/watch.ts` | At step 14, polls `gh pr view <n> --json state,reviewDecision,statusCheckRollup,comments,reviews` every 60 s via `$.process.run`, diffs against the last snapshot, emits alerts. Stops on merged/closed or when the step changes. |
| Persistence | `hooks/store.ts` | Reads and writes the run in `$.store` under key `run:<project root>`, with a `version` field. |
| Commands | `hooks/register.ts` | `/stWorkflow-status` prints the run history as text (no Claude turn); `/stWorkflow-abort` ends the run. |

`hooks/register.ts` wires the units to events: `session.start` (restore run,
register tool and commands, resume watcher), `prompt.submit` (record that the
human spoke, for the gate guard), `tool.call` on the advance tool,
`prompt.compose`, `ui.render`, `command.run`.

### 2.3 Run state

```ts
type Run = {
  version: 1
  id: string                 // random, per run
  feature: string            // one-line summary
  step: StepNo               // 1..15
  startedAt: number
  iter: { plan: number; spec: number; code: number }  // start at 1
  shipLoops: number          // returns to 10 from 13/14
  gateOpenedAt?: number      // when the current gate step was entered
  humanSpokeAt?: number      // last prompt.submit while the run is active
  turnsInStep: number        // for the stall hint
  skipped: StepNo[]          // [13, 14] when there's no repo
  pr?: { number: number; url: string; state: 'draft' | 'ready' | 'merged' | 'closed';
         checks: { name: string; state: 'pass' | 'fail' | 'running' | 'queued' }[];
         review: 'none' | 'approved' | 'changes'; comments: number }
  alert?: string             // latest unhandled PR event, shown on the rail
  history: { at: number; step: StepNo; text: string }[]
}
```

The rail reads the run through an `atom` declared in `types/index.d.ts`
(`PluginState['stworkflow'].run`), so writes redraw it.

### 2.4 Transitions and the gate guard

Legal edges: 1→2, 2→3, 3→4, 4→5, 5→2, 5→6, 6→7, 7→8, 8→9, 9→7 (after
correcting the spec), 9→10, 10→11, 11→10, 11→12, 12→13, 12→15, 13→10, 13→14,
14→10, 14→15.

Counters: 5→2 increments `iter.plan`; 9→7 increments `iter.spec`; 11→10,
13→10 and 14→10 increment `iter.code`; 13→10 and 14→10 also increment
`shipLoops`. 12→15 records `skipped = [13, 14]`.

**Gate guard:** leaving step 1, 4, 8 or 13 is legal only if
`humanSpokeAt > gateOpenedAt`. Claude interprets the human's natural-language
reply ("looks good but rename X" is a change request) and calls the tool; the
mod only guarantees Claude can't pass a gate on its own.

### 2.5 Starting and resuming

`workflow_advance({ to: 1 })` with no active run creates one. With an active
run in this project it returns an error describing the run; the skill tells
Claude to ask the human whether to resume (continue from the stored step) or
abandon (`/stWorkflow-abort`, then start again).

## 3. The rail

One row above the prompt, drawn only while a run is active in this project.
Plain `Text` with colour; works on the terminal and desktop surfaces.

```
━━━━━━━━━━┃━━━━━━━━┃◉──┃────────  10/15 build ⠹ ↺1 │ #128 ✔✔⠋
```

| Part | Rule |
|---|---|
| Rail | 15 cells × 2 chars, `┃` between phases. Done: `━━` in phase colour (plan yellow, spec magenta, build cyan, ship green). Pending: dim `──`. Skipped: dim `┄┄`. Head: the current step's glyph, pulsing — `◉` while Claude or a subagent works, `◈` when it's the human's turn. |
| Position | `n/15`, dim. |
| Step name | Lowercase, phase colour: input, plan, plan critic, plan review, route, spec, spec critic, spec review, route, build, code critic, draft PR, PR review, watching PR, done. |
| Activity | Spinner while work runs. At the human's turn, a white `◈` hint: steps 1 `describe the feature` / `answer in chat`; 4 and 8 `reply approve or what to change` (or `critic blocked · reply revise or approve` when the latest critic verdict blocked); 13 `reply ready or what to fix`. |
| Loops | `↺n` in orange, total revision loops; hidden at 0. |
| PR | From step 13: `│ #<n>` (a `Link` to the PR) and one mark per check (`✔ ✖ ⠋ ○`), then `approved` or `changes` when a reviewer acts. |
| Alert | At step 14, `run.alert` replaces the activity part in orange: `⚑ e2e failed · reply fix it`. Cleared by the next human message or a newer event. |
| Stall hint | Dim `stalled?` after 3 turns in one non-gate step with no `workflow_advance`. |

**Width:** rail and position take about 45 columns. When the line doesn't fit,
drop the PR part first, then the activity text. Below 60 columns, use one
character per cell (`━━━━◈─────────`).

**Notifications beyond the rail:** each step-14 change also gets a toast and a
⚑ transcript line (`$.ui.log`). Entering a human turn (1, 4, 8, 13) gets a toast
("Your turn: review the plan"). Nothing else notifies.

The critic verdict the rail needs ("blocked" vs "passed") is passed by Claude
in `workflow_advance`'s `note` when leaving a critic step, as
`{ verdict: 'pass' | 'block' }`.

## 4. Error handling

| Situation | Behaviour |
|---|---|
| Illegal jump | Tool error naming the legal next steps; state unchanged. |
| Gate exit before the human replied | Tool error: "the human hasn't replied since the gate opened". |
| Claude stops reporting | `prompt.compose` restates the step each turn; rail shows `stalled?` after 3 turns. |
| No `gh`, not authenticated, or no GitHub remote at step 12 | Tool tells Claude; Claude informs the human and advances 12→15; PR steps show as skipped. |
| `gh pr view` fails at step 14 | Back off 60 s → 2 min → 5 min. After 3 failures in a row: one toast + transcript line `⚑ can't reach GitHub: <reason>`; rail shows `#<n> ?`. Polling continues at 5 min. |
| Stored run has an unknown `version` or doesn't parse | Discard it, one transcript line saying so. |
| Session restart / mod reload | Restore from store; resume polling at step 14. |
| `/stWorkflow` while a run is active | Claude asks: resume or abandon. |

A hook that throws must not break the session: every hook falls through to
`next(e)` on error (rail: draw nothing; compose: add nothing) and logs to the
debug log.

## 5. Testing

Run with `claude plugin test` (no network, no session):

- `tests/machine.test.ts`: every legal and illegal edge, counters, skip path,
  gate guard.
- `tests/tool.test.ts`: `workflow_advance` through the real hook; gate exits
  refused until a `prompt.submit`; start/resume conflict.
- `tests/rail.test.ts`: mount `AbovePrompt` on `terminal` and `desktop`; assert
  the line at start, a gate, a blocked critic, after loops, PR with checks, an
  alert, narrow width, and no rail with no run.
- `tests/watch.test.ts`: mocked clock and stubbed `process.run` returning canned
  `gh` JSON; one alert per change, backoff path, stop on merge.

Release gate: `claude plugin validate` and `tsc -p .` clean.

`SKILL.md` is verified manually with one end-to-end run on a toy repo with a
GitHub remote, and one without.

## 6. Files

```
stworkflow/
├── .claude-plugin/plugin.json      # name, version, description, types
├── hooks/
│   ├── hooks.json                  # { "modules": ["./register.ts"] }
│   ├── register.ts
│   ├── machine.ts
│   ├── tool.ts
│   ├── compose.ts
│   ├── rail.tsx
│   ├── watch.ts
│   └── store.ts
├── skills/stWorkflow/SKILL.md
├── types/index.d.ts                # PluginState['stworkflow']
├── tests/*.test.ts
├── tsconfig.json
└── README.md                       # install, usage, tested Claude Code version
```

Development loads the folder with `claude --plugin-dir ~/projects/stworkflow`.
