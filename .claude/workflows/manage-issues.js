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
