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
| 12 | Draft PR | Check `git remote -v` and `gh auth status`. Missing either → tell the user, `to: 15`. Otherwise push and `gh pr create --draft` with a human-readable title and a description of what changed and why. On a return from review/PR (a PR already exists): push the new commits to that PR and advance to 13; don't create a new one. | `to: 13, pr: { number, url }` |
| 13 | PR review | Give the user the PR link; ask them to review. Wait. Approved → `gh pr ready <number>`, `to: 14`. Fixes → `to: 10`. Human wants to abandon the PR → confirm with them first, then ask them to run `/stWorkflow-abort` (there is no move from 13 to 15). | |
| 14 | Watch | The mod polls the PR and alerts the user. Do nothing unless asked. Asked to fix something → `to: 10`. The mod finishes the run on merge. PR closed without merging → ask the user whether to reopen it or end the run (`to: 15`). User wants to stop watching → `to: 15`. | |
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
