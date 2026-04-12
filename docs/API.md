# AutoDev Agent — API Reference

## REST API

AutoDev runs on `http://localhost:3000` by default.

### Tasks

#### Create task
```
POST /api/tasks
Content-Type: application/json

{
  "prompt": "Create a counter app with +, -, Reset buttons",
  "projectDir": "/path/to/project",
  "planningMode": "claude-cli",        // claude-cli | gemini-cli | codex-cli | debate | manual
  "agentId": "auto",                   // auto | claude-code | codex-cli | gemini-cli | aider | cline-cli
  "executionMode": "single",           // single | auto-cycle | parallel | arena
  "config": {
    "autoApprove": true,
    "costPreference": "balanced",       // cheap | balanced | quality
    "systemPrompt": "optional custom system prompt",
    "maxCycles": 5,
    "debateDrafterMode": "claude-cli"
  }
}

Response: 201 { id, status, prompt, projectDir, ... }
```

#### List tasks
```
GET /api/tasks?limit=20&offset=0&projectDir=/optional/filter
Response: 200 [{ id, prompt, status, agentId, projectDir, createdAt, updatedAt }]
```

#### Get task detail
```
GET /api/tasks/{id}
Response: 200 { id, prompt, status, result, attempts, events, ... }
```

#### Update task (approve/reject/stop)
```
PATCH /api/tasks/{id}
{ "action": "approve" | "reject" | "stop", "editedPlan": { ... } }
```

### Events (SSE)

```
GET /api/events?taskId={id}
Content-Type: text/event-stream

Events:
  status_change        { status: "planning" | "coding" | "verifying" | ... }
  log                  { level: "info" | "warn" | "error", message: "..." }
  plan_ready           { plan: { summary, codingPrompt, estimatedFiles, ... } }
  cost_update          { totalCostUsd, inputTokens, outputTokens, agentId }
  screenshot           { path, checkId }
  verification_result  { checkId, status, detail }
  agent_switch         { fromAgent, toAgent, reason }
  task_complete        { success, summary }
```

### Stats
```
GET /api/stats
Response: 200 { today: { total, completed, failed, running, successRate, totalCost } }
```

### Status
```
GET /api/status
Response: 200 { workerPool: { maxWorkers, ... }, agents: [...] }
```

### A2A Protocol
```
GET /api/a2a              → Agent Card (capabilities, skills)
POST /api/a2a             → JSON-RPC (tasks/send, tasks/get)
```

---

## Configuration Files

### .autodev/agents/*.md
Agent-specific instructions. Frontmatter + markdown body.
Roles: planner, coder, verifier, evaluator

### .autodev/hooks.json
Pipeline hooks. Events: TaskStart, PrePlan, PostPlan, PlanReview,
PreCode, PostCode, PreVerify, PostVerify, OnRetry, OnReplan,
TaskComplete, TaskFail, PreToolUse, PostToolUse, SessionStart,
SessionEnd, AgentSwitch, SubTaskStart, SubTaskComplete, PreCompact,
OnEscalation

### .autodev/skills/*.yaml
Skill bundles. Format:
```yaml
id: react-ui
name: React UI Polishing
version: 1.0.0
triggers:
  - projectType: react
promptModules:
  coding: prompts/coding-react.md
verification:
  gates:
    - pnpm build
```

### .autodev/mcp/config.json
MCP server configuration + pipeline mapping.

### AGENTS.md / CLAUDE.md
Project-level instructions. Hierarchically collected from root to working directory.

---

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| OPENROUTER_API_KEY | Yes (for VLM) | OpenRouter API key for vision analysis |
| AUTODEV_MAX_WORKERS | No | Max concurrent pipelines (default: 3) |
| AUTODEV_VLM_RUNS | No | VLM majority voting runs (default: 1) |
| AUTODEV_SAST_ENABLED | No | Enable Semgrep SAST scan (default: 0) |
| AUTODEV_PBT_ENABLED | No | Enable Property-Based Testing (default: 0) |
| AUTODEV_DEBATE_VERIFY | No | Enable Debate Verification (default: 0) |
| AUTODEV_BASE_URL | No | Base URL for A2A (default: http://localhost:3000) |
