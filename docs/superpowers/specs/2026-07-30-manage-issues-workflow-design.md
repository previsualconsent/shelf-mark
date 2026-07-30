# Manage-issues workflow design

## Purpose

Shelfmark is developed solo with GitHub issues/PRs as the tracker, and no CI/test
suite. Right now there are 6 open issues and 5 open PRs, each on a branch named
`issue-N-<slug>` matching its issue. Keeping PRs reviewed and issues without a PR
yet moving forward is manual toil. This workflow automates one pass of that
loop: pairing issues with PRs, dispatching a fixer or reviewer agent to each,
and reporting what happened — without merging or closing anything itself.

## Non-goals

- Not a fully unattended bot. It runs interactively, inside a Claude Code
  session, when invoked.
- Never merges or closes issues/PRs. The user always does that by hand after
  reading the pass's report.
- Not a persistent poller. One invocation = one pass over whatever is open
  right now. The user re-invokes it later for the next pass.

## Architecture

A saved Claude Code workflow script, `.claude/workflows/manage-issues.js`,
invoked via `Workflow({name: "manage-issues"})` (or a slash command wrapping
it). Each invocation:

1. **Discovery (deterministic, not an agent call).** Plain `gh issue list` /
   `gh pr list` calls fetch open issues and open PRs. Pairing uses the
   existing `issue-N-<slug>` branch-naming convention already in use in this
   repo — issue number `N` in an open PR's branch name pairs it to issue `N`.
   This is scripted string matching, not an LLM judgment call, since the
   convention is unambiguous today.
   - Issue with no matching open PR → **fixer track**.
   - Issue with a matching open PR → **reviewer track**.
   - PR that matches no open issue, or issue number not parseable from any
     open PR branch → reported as "unmatched," skipped for this pass (no
     silent action taken on ambiguous state).
2. **Fan-out.** Each issue/PR pair is independent, so pairs run concurrently
   via `pipeline()` (not a `parallel()` barrier — no pair needs another pair's
   result).
3. **Per-pair pipeline:**
   - *No PR yet:* `fixer` agent reads the issue, creates/updates branch
     `issue-N-<slug>`, implements, commits, pushes, opens a PR with
     `gh pr create` referencing the issue.
   - *PR open:* `reviewer` agent reads the diff and the issue it's meant to
     resolve, then takes exactly one of three actions:
     - **Approve** (`gh pr review --approve`) → pair is done for this pass.
     - **Request changes** (`gh pr review --request-changes` with specific,
       actionable comments) → `fixer` agent addresses only those comments
       with a follow-up commit, then `reviewer` re-reviews. This can repeat,
       capped at **10 rounds** per pair per pass.
     - **Flag for human** (`gh pr comment` noting the concern, no formal
       review state) → pair stops here for this pass; not routed back to
       fixer. Used when the concern needs the user's judgment (e.g.
       architectural direction), not another mechanical fix.
   - Hitting the 10-round cap is reported the same way as "flag for human" —
     visible in the summary, not silently dropped.
4. **Report.** The workflow returns a per-pair summary: new PRs opened,
   PRs approved (ready to merge), PRs still cycling with round count, PRs
   flagged for human judgment, and any pairs skipped due to `gh` errors or
   ambiguous matching. The user acts on this manually.

## Components

- **`.claude/workflows/manage-issues.js`** — script: discovery, pairing,
  pipeline wiring, report assembly. This *is* the orchestrator; there is no
  separate orchestrator agent call, since routing is unambiguous string
  matching against `gh` output.
- **`fixer` agent** — given an issue (initial dispatch) or specific review
  comments (re-dispatch), writes code, commits, pushes, opens/updates a PR
  via `gh`. Never force-pushes over commits it did not itself make earlier in
  the same pass, so it won't clobber manual pushes made between passes.
- **`reviewer` agent** — given a PR diff and the issue it claims to resolve,
  posts exactly one of: approve, request-changes-with-comments, or a
  flag-for-human comment. Never merges, never closes.

## Data flow per pair

```
issue N, no PR      -> fixer -> opens PR#
issue N, PR# open   -> reviewer -> approve           -> done, report "ready to merge"
                                -> request changes    -> fixer addresses -> reviewer (loop, max 10 rounds)
                                -> flag for human     -> done, report "needs your input"
                       (round cap reached)            -> done, report "needs your input"
```

## Error handling

- Each pair's pipeline errors (agent failure, `gh` auth/rate-limit issues,
  merge conflicts the fixer can't resolve) are caught per-pair; that pair is
  reported as errored in the final summary rather than aborting the whole
  pass.
- Unmatched PRs/issues (branch doesn't follow the `issue-N-<slug>` convention,
  or references an issue number with no open issue) are reported, not acted
  on.

## Testing / validation

No automated test suite exists in this repo. Validation is manual: run the
workflow once against the real current state (issue 1 with no PR, plus the 5
open PRs for issues 2–6), inspect the returned summary and the actual
GitHub-side effects (new PR opened for issue 1, reviews posted on the other
5), confirm nothing was merged or closed automatically, then iterate on the
script if agent prompts need tightening.
