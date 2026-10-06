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
