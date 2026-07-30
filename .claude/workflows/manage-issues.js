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
