---
fragment: git-event-trigger
description: Git event trigger — GitHub/GitLab webhooks normalized to a single payload
keywords: [pr, push, commit, 머지, merge, main, branch]
---

## Git event trigger

React to GitHub or GitLab events. AutoDev normalizes both providers' webhook payloads into one shape under `$trigger.event`.

```yaml
settings:
  allowedEnvKeys: [GH_WEBHOOK_SECRET]

triggers:
  - type: git_event
    source: webhook                   # webhook (default) | poll
    events: [pr_opened, pr_updated]   # required, see list below
    webhookConfig:
      provider: github                # github | gitlab
      secret: "${$env.GH_WEBHOOK_SECRET}"
    filter:
      branches: [main, release/*]      # glob patterns
      paths: [src/**, package.json]    # changed files (push/pr)
      prLabels: [ready-for-review]     # PR label filter
      ignorePaths: [docs/**, "*.md"]   # exclusions
```

### Supported event types
`pr_opened`, `pr_updated`, `pr_merged`, `pr_closed`, `push`, `tag_created`, `tag_deleted`.

### `$trigger.event` (normalized across GitHub/GitLab)
```typescript
{
  type: string,           // event name from the list above
  number?: number,        // PR number
  title?: string,         // PR title
  author: string,         // username / login
  headBranch: string,     // source branch / tag name
  baseBranch: string,     // target branch
  headSha: string,        // latest commit SHA
  repository: { owner: string, name: string, fullName: string },
  labels: string[],       // PR labels
  changedPaths?: string[] // for push / pr events
}
```

### Common pattern — auto code review on PR open
```yaml
- id: review
  type: agent
  role: reviewer
  prompt: |
    PR #${$trigger.event.number}: ${$trigger.event.title}
    Files: ${$trigger.event.changedPaths | join(', ')}
- id: post-comment
  type: mcp
  server: github
  tool: create_pull_request_review
  args:
    owner: "${$trigger.event.repository.owner}"
    repo: "${$trigger.event.repository.name}"
    pull_number: "${$trigger.event.number}"
    event: COMMENT
    body: "${$nodes.review.output.data}"
```

### Anti-pattern
Subscribing to all 7 events with no `filter` causes runaway runs on docs-only or unrelated changes. Always set `filter.branches` and/or `filter.ignorePaths`.
