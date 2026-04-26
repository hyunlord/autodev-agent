---
fragment: gate-human
description: Gate node — human-in-the-loop approval with timeout and notifications
keywords: [승인, 허락, 사람, human, approval, gate, pause, wait for]
---

## Gate (human-in-the-loop)

Pause the pipeline until a user makes a choice. The gate persists across server restarts (Stage 6).

```yaml
- id: pr-gate
  type: gate
  prompt: "CI passed. Merge PR #${$trigger.event.number}?"
  options: [approve_merge, reject]    # machine-readable identifiers
  defaultOption: reject               # picked when timeout fires
  timeout: 14400                      # seconds (4 hours)
  artifactsToShow: [ci-checks]        # node ids whose output is shown to the user
  notifyConfig:
    channels: [slack]
    webhookUrl: "${$env.SLACK_WEBHOOK}"
    reminderAfter: 3600               # re-notify after N seconds (0 = no reminder)
    messageTemplate: "Approval needed for task ${$task.id}"

# Read the decision downstream:
- id: merge
  type: mcp
  server: github
  tool: merge_pull_request
  args:
    owner: "${$trigger.event.repository.owner}"
    repo: "${$trigger.event.repository.name}"
    pull_number: "${$trigger.event.number}"
  when: { field: $nodes.pr-gate.output.data.decision, eq: approve_merge }
```

### `output.data` shape
```typescript
{
  decision: string,         // option the user picked (or defaultOption on timeout)
  decidedAt: string,        // ISO 8601
  decidedBy: string | null, // user id (null on timeout)
  timedOut: boolean,
  waitedSeconds: number
}
```

### Timeout behavior
- `timeout` set + `defaultOption` set → auto-pick `defaultOption`, `timedOut: true`
- `timeout` set + `defaultOption` missing → `ERR_GATE_TIMEOUT` → `onFailure` policy applies
- `timeout` omitted → wait indefinitely (persists across restarts)

### `$flow` inside a gate
- `$flow.gateStatus` — `pending` | `approved` | `rejected`
- `$flow.gateRespondedBy` — user id (or null)

### Naming pattern
Use snake_case machine identifiers for `options` (e.g. `approve_merge`, `request_changes`). Avoid free-form natural-language strings — they make `branch` matching error-prone.

### Anti-pattern
A `gate` between every step destroys UX. Place gates only at irreversible decisions (deploy, merge, release).
