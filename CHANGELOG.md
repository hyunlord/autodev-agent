# Changelog

All notable changes to AutoDev Agent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### AI Builder (G21 series)

- **POST /api/ai-builder** — natural language → ADPL pipeline YAML endpoint
  - Intent classification: `new` / `modify` / `clarify` / `explain`
  - Input validation: userMessage ≤4 000 chars, currentYaml ≤50 000 chars, history ≤10 turns × 2 000 chars
  - Sanitized error responses (no internal stack traces exposed)
- **AI Builder Orchestrator** — end-to-end generation pipeline
  - 5-section system prompt: IDENTITY / TASK / ADPL SPEC / OUTPUT FORMAT / EXAMPLES
  - Dynamic context assembly: base spec + up to 3 keyword-matched task fragments + few-shot examples
  - ADPL Compiler validation with retry loop (max 2 retries on compile errors)
  - Diff computation for `modify` intent (added / removed / modified nodes)
  - Per-request cost and token tracking
- **AI Builder Modal UI** (PipelineYamlViewer integration)
  - Step machine: `input` → `loading` → `result` / `clarify` → `saving`
  - Multi-turn clarify support with conversation thread visualization
  - Side-by-side YAML diff panel for `modify` intent
  - Intent badge, warnings, suggested next steps, cost display
  - Save → `pipeline_versions` integration

#### Phase P — ADPL Pipeline Language (Stage 1–7)

- **Stage 1** — Foundation: DB tables (`pipelines`, `pipeline_runs`, `pipeline_nodes`, `pipeline_events`, `pipeline_triggers`, `pipeline_templates`, `pipeline_variables`), ADPL TypeScript types (25 files), Zod schemas (29 files)
- **Stage 2** — Engine Core: Compiler (YAML → ExecutionPlan AST), Scheduler (ready queue + concurrency), Worker (NodeAdapter + retry), in-memory StateStore, in-process EventBus, PipelineExecutor API
- **Stage 3** — Leaf Adapters: HTTP, Shell, LLM, Code node adapters
- **Stage 4** — Flow Adapters: parallel, sequential, branch, loop node adapters
- **Stage 5** — Triggers + Expressions: cron, webhook, manual triggers; expression evaluator
- **Stage 6** — Durability + Observability: run persistence, structured logging, event stream
- **Stage 7** — UX Layer: AI Builder (G21 series), YAML diff viewer (G6), pipeline run timeline

#### Developer Tooling

- `pnpm db:backup` / `pnpm db:restore` — database backup and restore
- `pnpm db:verify` — table / FK / integrity check
- `pnpm adpl:validate <path>` — ADPL YAML validation CLI (glob support, `--format=json` for CI)
- `pnpm verify:cross` — cross-LLM verification (Build + TypeScript + API Health + UI + Verify Agent)
- `pnpm ship "msg"` — verify → commit → push pipeline

### Statistics

- **External packages added**: 0 across 54+ consecutive commits
- **Verify:cross average**: ~97/100 (A grade) across Phase P Stage 7
- **ADPL spec**: 4 900-line v1.0 formal specification (`docs/adpl-spec/v1.0.md`)

## [Earlier History]

Pre-v1.0 development history. See `git log` for the full commit record.
