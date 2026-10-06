# stWorkflow

A Claude Code plugin that runs a feature from idea to merged PR through a
15-step workflow, with adversarial reviews and human approval gates, and shows
progress as a single line above the prompt:

```
━━━━━━━━━━┃━━━━━━━┃◉──┃────────  10/15 build ⠹ ↺1 │ #128 ✔✔⠋
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
