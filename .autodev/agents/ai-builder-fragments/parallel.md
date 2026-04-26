---
fragment: parallel
description: Parallel node — concurrent branches with merge strategies
keywords: [병렬, 동시, parallel, concurrent, simultaneous]
---

## Parallel

Run independent branches concurrently and merge their results.

```yaml
- id: ci-checks
  type: parallel
  mergeStrategy: all_must_pass     # all_must_pass | any_succeeds | majority | best_score
  maxConcurrent: 3                 # cap on simultaneous branches
  onError: abort_all               # abort_all (default) | continue
  cancelOnFirstFailure: true       # fail-fast: cancel remaining branches on first failure
  branches:
    - id: lint
      nodes:
        - { id: lint-run, type: shell, command: "pnpm lint" }
    - id: test
      nodes:
        - { id: test-run, type: shell, command: "pnpm test", timeout: 120 }
    - id: tsc
      nodes:
        - { id: tsc-run, type: shell, command: "pnpm tsc --noEmit" }
```

### Merge strategies
- `all_must_pass` — every branch must succeed (CI gate)
- `any_succeeds` — at least one success suffices
- `majority` — more than half must succeed (3-of-5 etc.)
- `best_score` — always succeeds; picks the branch whose terminal node returns the highest `output.data.score` (number). Every branch's last node must produce `score: number`.

### `output.data` shape
```typescript
{
  branches: Array<{ id: string, status: "success"|"failure"|"cancelled", output: NodeOutput, duration: number }>,
  selected?: { id: string, score: number, output: NodeOutput }   // only with best_score
}
```

### `$flow` inside a branch
- `$flow.parallelIndex` — current branch index
- `$flow.parallelTotal` — total branch count

### Constraints
- Branches **cannot** reference each other through `$nodes` — they run in isolation.
- For dependency chains, sequence the parallel inside an outer pipeline (`build → parallel(lint, test)`), not as one parallel node.
- `onError: abort_all` + `cancelOnFirstFailure: true` produces the fastest fail; combine for CI gates.

### Anti-pattern
10+ branches with no `maxConcurrent` causes rate-limit / cost spikes. Always set `maxConcurrent: 3` (or a small N) for any wide fan-out.
