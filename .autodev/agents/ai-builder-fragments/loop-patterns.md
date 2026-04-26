---
fragment: loop-patterns
description: Loop node — forEach / times / while patterns with $loop context
keywords: [반복, each, foreach, n번, until, loop, iterate, retry]
---

## Loop

Three modes: `forEach` (iterate an array), `times` (fixed count), `while` (condition-based, **post-test** semantics).

### forEach
```yaml
- id: ticket-loop
  type: loop
  mode: forEach
  over: "$nodes.verify.output.data.issues"
  as: issue
  parallelism: 3                  # iterations to run concurrently (default 1)
  continueOnIterFailure: true     # keep going if one iteration fails
  do:
    - id: create-ticket
      type: mcp
      server: linear
      tool: create_issue
      args:
        title: "${$loop.issue.title | truncate(80)}"
        priority: "${$loop.issue.severity}"
```

### times
```yaml
- id: flaky-retry
  type: loop
  mode: times
  count: 5
  breakCondition: { field: $nodes.e2e.output.data.exitCode, eq: 0 }   # early exit
  do:
    - { id: e2e, type: shell, command: "pnpm test:e2e", failOnNonZero: false }
```

### while (post-test, do-while semantics)
The `do` block runs **first**, then `condition` is evaluated. `maxIterations` is **required** to bound execution. The block always runs at least once.

```yaml
- id: wait-deploy
  type: loop
  mode: while
  condition: { field: $nodes.poll.output.data.status, nin: [deployed, failed] }
  maxIterations: 60               # required for while
  do:
    - { id: sleep, type: shell, command: "sleep 5" }
    - { id: poll, type: http, url: "${$env.STATUS_URL}", method: GET }
```

### `$loop` context (only inside `do`)
- `$loop.index` — current iteration (0-based)
- `$loop.total` — total iterations (forEach / times only)
- `$loop.isFirst`, `$loop.isLast` — booleans
- `$loop.<as>` — current item (forEach only)

### `output.data` shape
```typescript
{
  iterations: Array<{ index, item?, status, output, duration }>,
  totalIterations: number,
  completedIterations: number,
  failedIterations: number,
  brokeEarly: boolean             // true when breakCondition fired
}
```

### Anti-patterns
- `mode: while` without `maxIterations` — compile-time error, blocked by validator.
- Treating `while` as pre-test — it always runs at least once. For a 0-iteration case, gate with a `branch` first.
- `parallelism > 1` for order-dependent work (e.g. appending to a single file) — race condition.
