# Manage-Issues Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `.claude/workflows/manage-issues.js`, a reusable Claude Code workflow that does one pass of shelf-mark's issue/PR triage — pairing open issues with open PRs, dispatching fixer/reviewer agents, and reporting results without merging or closing anything.

**Architecture:** A single workflow script with no separate orchestrator agent. Deterministic JS pairs issues to PRs by matching the `issue-N-<slug>` branch convention already used in this repo. Two concurrent pipelines then run: one dispatches a `fixer` agent per issue with no open PR, the other dispatches a `reviewer` agent per open PR (looping with a `fixer` for up to 10 rounds if changes are requested). The script returns a structured summary; the human merges/closes by hand afterward.

**Tech Stack:** Claude Code `Workflow` tool (plain-JS-subset DSL: `agent()`, `pipeline()`, `phase()`, `log()`), `gh` CLI (already authenticated in this environment), this repo's existing `issue-N-<slug>` branch convention.

## Global Constraints

- File lives at `.claude/workflows/manage-issues.js` so it can be invoked by name: `Workflow({name: "manage-issues"})`.
- One pass per invocation — no internal polling loop, no waiting for human merges mid-run.
- The reviewer agent must never merge or close a PR — only `gh pr review` (approve/request-changes) or `gh pr comment` (flag for human).
- The fixer agent must never force-push over commits it did not itself make earlier in the same pass.
- Review↔fix loop is capped at **10 rounds** per PR per pass; hitting the cap is reported the same as "needs your input," never silently dropped.
- Reviewer picks exactly one of three actions per review: `approve`, `request_changes`, or `flag_human`. Only `request_changes` routes back to the fixer.
- Issue↔PR pairing uses the branch-name convention `issue-N-<slug>` (already in use for issues 2–6 / PRs 7–11 in this repo). PRs that don't match any open issue, or issue numbers with no open PR, are reported as unmatched — never acted on.
- The Workflow script body has no Bash/filesystem access itself — every `gh` call happens inside an `agent()` call. Deterministic logic (pairing, routing) is plain JS operating on an agent's returned JSON, not a separate LLM decision.

---

### Task 1: Discovery and deterministic pairing

**Files:**
- Create: `.claude/workflows/manage-issues.js`

**Interfaces:**
- Produces: `discovery.issues` (`{number, title, body}[]`), `discovery.prs` (`{number, title, headRefName}[]`), `noPrPairs` (issue objects), `openPrPairs` (`{issue, pr}[]`), `unmatchedPrs` (pr objects) — later tasks consume these directly by these exact names.

- [ ] **Step 1: Write the discovery + pairing script**

```js
export const meta = {
  name: 'manage-issues',
  description: 'One pass of issue/PR triage: pair issues with PRs, dispatch fixer/reviewer agents, report results',
  phases: [
    { title: 'Discover' },
    { title: 'Triage' },
    { title: 'Report' },
  ],
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['number', 'title', 'body'],
      },
    },
    prs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          title: { type: 'string' },
          headRefName: { type: 'string' },
        },
        required: ['number', 'title', 'headRefName'],
      },
    },
  },
  required: ['issues', 'prs'],
}

phase('Discover')
const discovery = await agent(
  'Run exactly these two commands in the shelf-mark repo and return their output verbatim as JSON, with no filtering or analysis: ' +
  '`gh issue list --state open --json number,title,body` and `gh pr list --state open --json number,title,headRefName`.',
  { label: 'discovery', schema: DISCOVERY_SCHEMA }
)

function issueNumberFromBranch(branch) {
  const m = /^issue-(\d+)-/.exec(branch)
  return m ? Number(m[1]) : null
}

const prByIssue = new Map()
const unmatchedPrs = []
for (const pr of discovery.prs) {
  const n = issueNumberFromBranch(pr.headRefName)
  if (n == null) {
    unmatchedPrs.push(pr)
  } else {
    prByIssue.set(n, pr)
  }
}

const noPrPairs = discovery.issues.filter(i => !prByIssue.has(i.number))
const openPrPairs = discovery.issues
  .filter(i => prByIssue.has(i.number))
  .map(i => ({ issue: i, pr: prByIssue.get(i.number) }))

log(`${noPrPairs.length} issue(s) need a PR, ${openPrPairs.length} PR(s) need review, ${unmatchedPrs.length} PR(s) unmatched`)

return { noPrPairs, openPrPairs, unmatchedPrs }
```

- [ ] **Step 2: Validate against real repo state**

This step only runs read-only `gh list` commands — safe to run without further confirmation. Invoke the `Workflow` tool with `scriptPath` set to `.claude/workflows/manage-issues.js`. Inspect the returned result.

Expected (given the repo state at the time this plan was written: issue 1 has no PR; issues 2–6 have open PRs 7–11 on branches `issue-2-...` through `issue-6-...`):
- `noPrPairs` has exactly one entry, issue number `1`.
- `openPrPairs` has exactly five entries, pairing issues 2–6 to their respective PRs.
- `unmatchedPrs` is empty.

If the counts don't match, fix `issueNumberFromBranch` or the discovery prompt before moving on — don't proceed with broken pairing.

- [ ] **Step 3: Commit**

```bash
git add .claude/workflows/manage-issues.js
git commit -m "Add discovery and issue/PR pairing to manage-issues workflow"
```

---

### Task 2: Reviewer stage (single pass, no fix loop yet)

**Files:**
- Modify: `.claude/workflows/manage-issues.js` (replace the `return` statement at the end of Task 1's script)

**Interfaces:**
- Consumes: `openPrPairs` (`{issue, pr}[]`) from Task 1.
- Produces: `reviewed` (`{issue, prNumber, review: {action, comments}}[]`) — Task 4 replaces this shape with a richer one (`rounds`, `status`), so don't rely on this exact shape outside this task.

- [ ] **Step 1: Add the reviewer schema, prompt, and pipeline**

Replace the final `return { noPrPairs, openPrPairs, unmatchedPrs }` line with:

```js
const REVIEWER_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['approve', 'request_changes', 'flag_human'] },
    comments: { type: 'string' },
  },
  required: ['action', 'comments'],
}

function reviewerPrompt(issue, prNumber) {
  return `In the shelf-mark repo, review PR #${prNumber}, which claims to resolve issue #${issue.number} ("${issue.title}"). ` +
    `Read the diff with \`gh pr diff ${prNumber}\` and the issue body below, then take exactly one action:\n` +
    `- approve (\`gh pr review ${prNumber} --approve\`) if the change correctly and safely resolves the issue.\n` +
    `- request_changes (\`gh pr review ${prNumber} --request-changes --body "..."\`) with specific, actionable comments, if it has concrete, mechanically fixable problems.\n` +
    `- flag_human (\`gh pr comment ${prNumber} --body "..."\`, no formal review state) if the concern needs human judgment (e.g. architectural direction) rather than another mechanical fix.\n` +
    `Never merge the PR.\n\nIssue body:\n${issue.body}\n\nReport {action, comments} describing what you did.`
}

phase('Triage')
const reviewed = await pipeline(
  openPrPairs,
  ({ issue, pr }) => agent(reviewerPrompt(issue, pr.number), { label: `reviewer:pr-${pr.number}`, phase: 'Triage', schema: REVIEWER_SCHEMA })
    .then(review => ({ issue, prNumber: pr.number, review }))
)

phase('Report')
return { noPrPairs, reviewed, unmatchedPrs }
```

- [ ] **Step 2: Confirm with the user before running**

This step's validation posts real `gh pr review` / `gh pr comment` calls on the five live open PRs (#7–11) — visible to anyone watching the repo. **Stop and ask the user to confirm before running this validation.** Do not run it unattended.

- [ ] **Step 3: Validate against real open PRs (after confirmation)**

Invoke the `Workflow` tool with `scriptPath` set to `.claude/workflows/manage-issues.js`. Inspect the returned `reviewed` array and, on GitHub, confirm each PR (#7–11) got exactly one of: an approval, a request-changes review with specific comments, or a flag-for-human comment — and that none were merged or closed.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/manage-issues.js
git commit -m "Add reviewer stage to manage-issues workflow"
```

---

### Task 3: Fixer stage for issues with no PR yet

**Files:**
- Modify: `.claude/workflows/manage-issues.js`

**Interfaces:**
- Consumes: `noPrPairs` (issue objects) from Task 1.
- Produces: `fixed` (`{issue, result: {ok, prNumber, summary}}[]`).

- [ ] **Step 1: Add the fixer schema, prompt, and pipeline**

Replace:

```js
phase('Triage')
const reviewed = await pipeline(
```

with:

```js
const FIXER_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    prNumber: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['ok', 'summary'],
}

function newIssueFixerPrompt(issue) {
  return `In the shelf-mark repo, implement issue #${issue.number} ("${issue.title}"):\n\n${issue.body}\n\n` +
    `Create branch issue-${issue.number}-<slug> (choose a short slug from the title), implement the change, commit, push the branch, ` +
    `and open a PR with \`gh pr create\` that references "#${issue.number}" in its body. ` +
    `Report {ok, prNumber, summary} — ok is false if you could not complete this.`
}

phase('Triage')
const fixed = await pipeline(
  noPrPairs,
  issue => agent(newIssueFixerPrompt(issue), { label: `fixer:issue-${issue.number}`, phase: 'Triage', schema: FIXER_SCHEMA })
    .then(result => ({ issue, result }))
)

const reviewed = await pipeline(
```

And update the final `return` to:

```js
phase('Report')
return { fixed, reviewed, unmatchedPrs }
```

- [ ] **Step 2: Confirm with the user before running**

This step's validation creates a real branch and PR for issue #1 ("Feature Request") — a real, visible GitHub side effect. **Stop and ask the user to confirm before running this validation**, and confirm they're fine with the fixer's interpretation of issue #1's (currently vague) body before it starts writing code.

- [ ] **Step 3: Validate against issue #1 (after confirmation)**

Invoke the `Workflow` tool with `scriptPath` set to `.claude/workflows/manage-issues.js`. Inspect `fixed[0].result` — `ok` should be `true` and `prNumber` should point at a real new PR referencing issue #1. Confirm on GitHub that the PR exists and issue #1 is still open (fixer never closes issues).

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/manage-issues.js
git commit -m "Add fixer stage for issues with no PR yet"
```

---

### Task 4: Review-fix loop with round cap, status, and final report

**Files:**
- Modify: `.claude/workflows/manage-issues.js`

**Interfaces:**
- Consumes: `openPrPairs`, `REVIEWER_SCHEMA`, `FIXER_SCHEMA`, `reviewerPrompt` from earlier tasks.
- Produces: final script output shape `{ fixed, reviewed, unmatchedPrs }` where each `reviewed` entry is now `{issue, prNumber, rounds, action, comments, status}` with `status` in `('ready_to_merge', 'needs_input')`.

- [ ] **Step 1: Add the round-capped review-fix loop**

Replace:

```js
const reviewed = await pipeline(
  openPrPairs,
  ({ issue, pr }) => agent(reviewerPrompt(issue, pr.number), { label: `reviewer:pr-${pr.number}`, phase: 'Triage', schema: REVIEWER_SCHEMA })
    .then(review => ({ issue, prNumber: pr.number, review }))
)
```

with:

```js
function reviewFixerPrompt(issue, prNumber, comments) {
  return `In the shelf-mark repo, on the branch backing PR #${prNumber} (which resolves issue #${issue.number}), ` +
    `address this reviewer feedback with a follow-up commit and push it — do not force-push over existing commits: ${comments}. ` +
    `Report {ok, prNumber, summary}.`
}

async function reviewWithFixLoop(issue, prNumber) {
  let rounds = 0
  let review = null
  while (rounds < 10) {
    review = await agent(reviewerPrompt(issue, prNumber), { label: `reviewer:pr-${prNumber}:r${rounds}`, phase: 'Triage', schema: REVIEWER_SCHEMA })
    if (review.action !== 'request_changes') break
    const fix = await agent(reviewFixerPrompt(issue, prNumber, review.comments), { label: `fixer:pr-${prNumber}:r${rounds}`, phase: 'Triage', schema: FIXER_SCHEMA })
    rounds++
    if (!fix.ok) break
  }
  const status = review.action === 'approve' ? 'ready_to_merge' : 'needs_input'
  return { issue, prNumber, rounds, action: review.action, comments: review.comments, status }
}

const reviewed = await pipeline(
  openPrPairs,
  ({ issue, pr }) => reviewWithFixLoop(issue, pr.number)
)
```

- [ ] **Step 2: Confirm with the user before running**

This is the full, real pass over the current repo state — it will create a PR for issue #1 (if Task 3's PR wasn't merged/closed yet, skip re-running the fixer for issue #1, or close/merge that test PR first so this run starts clean) and post reviews on PRs #7–11, possibly iterating fixer commits onto them. **Stop and ask the user to confirm before running this validation.**

- [ ] **Step 3: Validate the full pass (after confirmation)**

Invoke the `Workflow` tool with `scriptPath` set to `.claude/workflows/manage-issues.js`. Inspect the final `{ fixed, reviewed, unmatchedPrs }` result:
- Every `reviewed` entry has a `status` of either `ready_to_merge` or `needs_input`.
- `rounds` never exceeds 10 for any entry.
- On GitHub, confirm no PR was merged or closed by any agent.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/manage-issues.js
git commit -m "Add round-capped review-fix loop and final report to manage-issues workflow"
```
