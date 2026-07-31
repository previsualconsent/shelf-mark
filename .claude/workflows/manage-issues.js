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

const issueNumbers = new Set(discovery.issues.map(i => i.number))
const prByIssue = new Map()
const unmatchedPrs = []
for (const pr of discovery.prs) {
  const n = issueNumberFromBranch(pr.headRefName)
  if (n == null || !issueNumbers.has(n)) {
    unmatchedPrs.push(pr)
  } else if (prByIssue.has(n)) {
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
    `Read the diff with \`gh pr diff ${prNumber}\` and the issue body below, then decide exactly one verdict:\n` +
    `- approve if the change correctly and safely resolves the issue.\n` +
    `- request_changes with specific, actionable comments, if it has concrete, mechanically fixable problems.\n` +
    `- flag_human if the concern needs human judgment (e.g. architectural direction) rather than another mechanical fix.\n` +
    `Never call \`gh pr review --approve\` or \`gh pr review --request-changes\` — this repo's PRs are always authored by the same GitHub account that would be reviewing them, so GitHub rejects any formal review state as self-approval. ` +
    `Regardless of your verdict, record it with \`gh pr comment ${prNumber} --body "..."\` stating plainly whether you consider it approved or in need of further review, and why. ` +
    `Never merge the PR.\n\nIssue body:\n${issue.body}\n\nReport {action, comments} describing your verdict and the comment you posted.`
}

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

phase('Report')
return { fixed, reviewed, unmatchedPrs }
