---
role: ai-builder-base-spec
description: ADPL v1.0 compressed reference for AI Builder LLM context
---

ADPL (AutoDev Pipeline Description Language) v1.0 — compressed reference. Full spec: `docs/adpl-spec/v1.0.md`.

## Hello World

```yaml
adplVersion: 1
name: hello-world
triggers:
  - type: manual
pipeline:
  - id: greet
    type: agent
    prompt: "Write a friendly greeting."
```

## Top-level

`adplVersion` (int, =1, required) · `name` (string, `^[a-z0-9][a-z0-9-]{0,62}$`, unique per project, required) · `description` · `triggers` (default `[{type: manual}]`) · `pipeline` (≥1 node, required) · `settings` · `metadata`.

`settings` keys: `maxParallel`, `totalTimeout`, `nodeTimeout`, `onNodeFailure` (`abort`|`continue`), `totalCostLimit`, `retryPolicy`, `allowedEnvKeys[]`.

## Context variables

- `$task.{id, prompt, tags, createdAt, projectId, config}`
- `$project.{id, name, path, description}`
- `$nodes.<id>.output.{status, data, error, duration, costUsd}` — only nodes defined earlier in `success`/`failure`/`skipped` state
- `$loop.{index, total, isFirst, isLast, <as>}` — inside `loop` only
- `$flow.{matchedBranch | parallelIndex/parallelTotal | gateStatus/gateRespondedBy}` — inside flow nodes
- `$env.<KEY>` — must be in `settings.allowedEnvKeys[]`; auto-masked in logs
- `$trigger.{type, firedAt, payload, scheduledAt}`

## Expressions

**Slot 1** (interpolation, in string values): `${expr}`, `${expr | filter}`, `${expr ?? fallback}`. Filters: `truncate(n)`, `lower`, `upper`, `json`, `round`, `toFixed(n)`, `replace(a,b)`, `slice(s,e)`, `default(v)`, `join(sep)`, `length`, `escape`, `urlencode`, `jsonParse`, `toDate`, `toTime`, `padStart(n,c)`, `trim`, `capitalize`. **No ternary**.

**Slot 2** (conditions, in `when`/`condition`/`filter` fields):

```yaml
when:
  field: $nodes.verify.output.data.score
  gte: 80
# Composite:
when:
  all: [{...}, {...}]
  any: [{...}]
  not: {...}
```

Operators: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `matches`, `exists`, `empty`, `truthy`. Optional `transform: lower|upper|length` inside a condition.

## Node types (11)

### `agent` — call an LLM
```yaml
- id: plan
  type: agent
  role: planner          # planner|coder|verifier|reviewer|custom
  model: claude-code     # required when role=custom
  prompt: "Plan: ${$task.prompt}"
  output: { schema: { score: number, summary: string }, parseAs: json }
  maxTokens: 4096
  retryPolicy: { maxAttempts: 2, backoffSec: 5 }
```
Fields: `role`, `model`, `prompt`, `systemPrompt`, `inputs`, `output`, `useMemory`, `maxTokens`, `temperature`, `costLimit`, `timeout`, `retryPolicy`, `fallback`, `toolPolicy`, `when`, `onFailure`.

### `shell` — run a command
```yaml
- id: test
  type: shell
  command: "pnpm test"
  mode: shell            # shell|exec — use exec+args for user input (no injection)
  outputFormat: auto     # auto|text|json|lines|binary
  failOnNonZero: true
  allowExitCodes: [0, 1]
```
Fields: `command`, `args`, `mode`, `cwd`, `env`, `stdin`, `outputFormat`, `failOnNonZero`, `allowExitCodes`, `timeout`, `retryPolicy`, `idempotencyKey`, `when`.

### `http` — HTTP request
```yaml
- id: fetch
  type: http
  url: "https://api.x/r"
  method: GET            # GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS
  headers: { Authorization: "Bearer ${$env.TOKEN}" }
  bodyFormat: json       # json|form|text|binary|multipart
```
Fields: `url`, `method`, `headers`, `queryParams`, `body`, `bodyFormat`, `allowedHosts`, `idempotencyKey`, `timeout`, `retryPolicy`, `when`. POST/PATCH retry only with `idempotencyKey`.

### `webhook_out` — outbound notification
```yaml
- id: notify
  type: webhook_out
  provider: slack        # slack|discord|teams|generic
  url: "${$env.SLACK_WEBHOOK_URL}"
  body: { text: "Done ✅" }
  silentFail: true
```
Fields: `provider`, `url`, `body`, `silentFail`, `failOnError`, `rateLimitPerMinute`, `timeout`, `retryPolicy`, `when`. `body` schema differs per provider (Slack: `text`/`attachments`; Discord: `content`/`embeds`).

### `branch` — if/elif/else
```yaml
- id: route
  type: branch
  evaluationMode: first_match    # first_match|all_match
  cases:
    - when: { field: $nodes.verify.output.data.score, gte: 80 }
      then:
        - { id: ok, type: agent, role: custom, model: claude-code, prompt: "Approve." }
    - default: true
      then:
        - { id: fix, type: agent, role: coder, prompt: "Improve." }
```
Each case has exactly one of `when` / `default: true`, plus `then: [nodes]`. Optional: `onMissingMatch` (`skip`|`error`).

### `parallel` — concurrent branches
```yaml
- id: checks
  type: parallel
  mergeStrategy: all_must_pass   # all_must_pass|any_succeeds|majority|best_score
  maxConcurrent: 3
  branches:
    - id: lint
      nodes: [{ id: lint-cmd, type: shell, command: "pnpm lint" }]
    - id: test
      nodes: [{ id: test-cmd, type: shell, command: "pnpm test" }]
```
Branches cannot reference each other via `$nodes`. Fields: `branches`, `mergeStrategy`, `maxConcurrent`, `onError` (`abort_all`|`continue`), `cancelOnFirstFailure`.

### `loop` — repeat node block
```yaml
# forEach
- id: each
  type: loop
  mode: forEach          # forEach|times|while
  over: "$nodes.verify.output.data.issues"
  as: issue
  do:
    - { id: t, type: mcp, server: linear, tool: create_issue, args: { title: "${$loop.issue.title}" } }

# times — count required
# while — condition + maxIterations required
```
Fields: `mode`, `over`/`count`/`condition`, `as`, `do`, `maxIterations`, `parallelism`, `breakCondition`. Inside `do`: `$loop.index`, `$loop.total`, `$loop.<as>`.

### `gate` — human-in-the-loop pause
```yaml
- id: approve
  type: gate
  prompt: "Merge this PR?"
  options: [approve, reject]
  timeout: 3600
  defaultOption: reject
```
Decision read via `$nodes.<id>.output.data.decision`. Fields: `prompt`, `options`, `timeout`, `defaultOption`, `notify`, `requireRole`.

### `mcp` — call an external MCP tool
```yaml
- id: ticket
  type: mcp
  server: linear         # name registered in .autodev/mcp.json
  tool: create_issue
  args: { title: "Bug: ${$task.prompt | truncate(50)}" }
  sessionMode: per_task  # per_task|shared|per_node
```
Fields: `server`, `tool`, `args`, `sessionMode`, `argsValidation`, `timeout`, `retryPolicy`, `when`.

### `set` — compute and store values
```yaml
- id: metrics
  type: set
  values:
    weighted: "${$nodes.verify.output.data.score * 0.7 + $nodes.lint.output.data.score * 0.3}"
    passed: "${$nodes.verify.output.data.score >= 70}"
```
Read downstream via `$nodes.<id>.output.data.<key>`.

### `transform` — array filter/map/pluck
```yaml
- id: critical
  type: transform
  input: "$nodes.scan.output.data.findings"
  operation: filter      # filter|map|pluck
  params: { where: { field: severity, eq: critical } }
```
`map` uses `params.template: { ... }` with `${item.<field>}`. `pluck` uses `params.field: <name>`. Result at `$nodes.<id>.output.data.result`.

## Triggers (5)

- `manual` — `inputSchema` (form fields: `string`/`number`/`boolean`/`select`+`options`), `confirmMessage`. Values at `$trigger.payload.<name>`.
- `task_created` — `tags[]` (any-match), `filter` (Slot 2).
- `schedule` — `mode` (`cron`|`interval`|`once`), `cron` (5-field), `interval` (sec), `at` (ISO), `timezone`, `overlap` (`skip`|`queue`|`concurrent`), `validFrom`, `validUntil`, `maxRuns`.
- `webhook_in` — `path`, `method`, `auth` (`none`|`header`|`hmac`|`basic`), `secret`, `responseMode` (`immediate`|`sync`).
- `git_event` — `events[]` (`pr_opened`|`pr_updated`|`pr_merged`|`pr_closed`|`push`|`tag_created`|`tag_deleted`), `webhookConfig.{provider,secret}`, `filter.{branches,paths,prLabels,ignorePaths}`. Normalized payload at `$trigger.event`.

## Validation (compile-time)

Every `id` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is unique pipeline-wide (including nested flow nodes). All `$nodes.<id>` references must point to a node defined earlier (not inside an unrelated flow branch). Required fields per type are enforced (e.g. `agent.prompt` when `role: custom`, `loop.maxIterations` when `mode: while`). Each `branch.cases` item has exactly one of `when` or `default: true`. Expressions are always strings — quote them in YAML.

## Anti-patterns

- `${$task.tags.includes('ui')}` ❌ — JS method calls not supported. Use `{ field: $task.tags, contains: ui }`.
- `${score >= 80 ? 'pass' : 'fail'}` ❌ — no ternary. Use a `branch` node, or `set` with `when`.
- `command: "echo ${$task.prompt}"` ❌ — shell injection. Use `mode: exec` + `args: ["${$task.prompt}"]`.
- `${$env.KEY}` without `settings.allowedEnvKeys: [KEY]` ❌ — security error.
