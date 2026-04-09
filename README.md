# AutoDev Agent

Universal AI development orchestrator. Submit a goal in plain language → AutoDev plans, codes, and verifies automatically.

## Features

- **Multi-Agent Pipeline**: Plan → Code → Verify with independent LLM agents
- **Cross-LLM Verification**: Coding agent ≠ Verify agent (prevents self-rationalization)
- **5 Coding Agents**: Claude Code, Codex CLI, Gemini CLI, Aider, Cline
- **Debate Mode**: Drafter → Challenger → Quality Checker for complex tasks
- **VLM Design Scoring**: Screenshot → Vision LLM → 0-15 design quality score
- **Hook System**: 12 pipeline events × 4 hook types (command/script/agent/http)
- **Web Dashboard**: Real-time monitoring, plan review, diff preview, cost tracking

## Quick Start

```bash
git clone https://github.com/hyunlord/autodev-agent.git
cd autodev-agent
cp .env.example .env  # Add your API keys
pnpm install
pnpm dev
```

Open http://localhost:3000

## Requirements

- Node.js 18+
- pnpm
- At least one coding CLI installed: `claude` (Claude Code), `codex` (Codex CLI), or `gemini` (Gemini CLI)

## Architecture

```
User → Dashboard → API → Worker (IPC)
                            ├── Planning (Normal / Debate)
                            ├── Coding (5 agents)
                            ├── Verification
                            │   ├── Stage 1: Mechanical checks
                            │   ├── Stage 2: Evidence (files + screenshot + CSS)
                            │   ├── Stage 2.5: VLM design analysis
                            │   └── Stage 3: LLM judgment
                            └── Retry / Re-plan
```

## Configuration

- `.autodev/agents/*.md` — Agent-specific instructions
- `.autodev/hooks.json` — Pipeline hooks
- `.autodev/mcp/config.json` — MCP server config
- `.autodev/prompts/*.md` — Custom prompt library
- `.env` — API keys (see .env.example)

## Tech Stack

Next.js 15 · TypeScript (strict) · SQLite + Drizzle ORM · Tailwind CSS

## License

MIT
