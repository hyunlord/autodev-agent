---
fragment: mcp-integration
description: MCP node — call external tools via Model Context Protocol (Linear/GitHub/Notion/...)
keywords: [linear, notion, github, jira, mcp]
---

## MCP integration

Call tools exposed by external MCP servers. Servers are registered in `.autodev/mcp.json` (project) or `~/.autodev/mcp.json` (global).

```yaml
- id: create-ticket
  type: mcp
  server: linear              # name registered in .autodev/mcp.json
  tool: create_issue
  args:
    title: "Bug: ${$task.prompt | truncate(60)}"
    description: "${$nodes.verify.output.data.issues[0].description}"
    projectId: "${$env.LINEAR_PROJECT_ID}"
    priority: 1
    labelIds: [auto-generated, bug]
  sessionMode: per_task       # per_task (default) | shared | per_node
  argsValidation: true        # default — validate args against the tool schema
  timeout: 30
  retryPolicy: { maxAttempts: 3, backoff: exponential, initialDelay: 10 }
```

### Server registration (`.autodev/mcp.json`)
```json
{
  "servers": {
    "linear":  { "command": "npx", "args": ["-y", "@linear/mcp-server"], "env": { "LINEAR_API_KEY": "${LINEAR_API_KEY}" } },
    "github":  { "command": "npx", "args": ["-y", "@github/mcp-server"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } },
    "notion":  { "command": "npx", "args": ["-y", "@notion/mcp-server"], "env": { "NOTION_TOKEN": "${NOTION_TOKEN}" } }
  }
}
```

### Session modes
- `per_task` (default) — server spawned at task start, terminated at end
- `shared` — server reused across tasks; only safe for stateless servers
- `per_node` — fresh process per node call; required for sensitive data isolation (Stripe, billing, write-state)

### `output.data` shape
```typescript
{ result: unknown, callId: string, duration: number }
```

### Common pattern — PR review comment
```yaml
- id: review
  type: agent
  role: reviewer
  prompt: "Review this PR: ${$trigger.event.title}"
- id: post
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

### Anti-patterns
- `sessionMode: shared` for billing / payment / write-state servers — state leak risk. Use `per_node`.
- `args` carrying multi-KB blobs — stdio buffers choke. Truncate or pluck only the fields the tool needs.
- `argsValidation: false` — typos surface only at runtime; keep the default `true`.
