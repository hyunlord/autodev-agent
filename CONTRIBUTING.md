# Contributing to AutoDev Agent

Thank you for your interest in contributing to AutoDev Agent!

## Project Overview

AutoDev Agent is a universal AI development orchestrator that automates the
Plan → Code → Verify pipeline using multiple LLM agents. It runs locally,
requires no cloud infrastructure, and supports any Claude-compatible model.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- `ANTHROPIC_API_KEY` (for Claude API access)

### Setup

```bash
git clone https://github.com/hyunlord/autodev-agent.git
cd autodev-agent
pnpm install
pnpm db:push
pnpm dev
```

Open `http://localhost:3000` to verify the UI is running.

## Development Workflow

### Architecture Principles

- **Agent independence** — Planning, Coding, and Verify are separate agents; each can use a different model
- **Cross-model verification** — Verify always uses a different LLM than Coding to prevent self-rationalization
- **Pipeline-level hooks** — Hook enforcement is agent-agnostic via ADPL triggers
- **A grade required** — Every commit must pass `pnpm verify:cross` with 95+/100

### Commit Pipeline

```bash
# Make your changes, then:
pnpm verify:cross   # Must pass 95+/100
pnpm ship "your commit message"  # Auto-commits and pushes if verify passes
```

Direct `git commit` is discouraged — use `pnpm ship` to ensure quality gates are met.

### Useful Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm verify:cross` | Full cross-LLM verification |
| `pnpm ship "msg"` | Verify → commit → push |
| `pnpm db:push` | Apply schema changes |
| `pnpm db:backup` | Backup database |
| `pnpm adpl:validate <path>` | Validate ADPL YAML |

## Code Standards

- **TypeScript strict mode** — no implicit `any`
- **Zod schemas** for all external input validation
- **Drizzle ORM** — no raw SQL; schema changes via `pnpm db:push`
- **nanoid** for ID generation
- **No unnecessary external packages** — the project has maintained 0 new external packages across 54+ consecutive commits; please justify any new dependency carefully
- **Follow existing patterns** — check similar files before introducing new abstractions

## Areas Open for Contribution

### Beginner-Friendly

- Documentation improvements (typos, clarity, examples)
- Bug reports with clear reproduction steps
- Translation improvements (Korean ↔ English)

### Intermediate

- New trigger types (cron variants, git event filters)
- AI Builder fragment additions (new ADPL node patterns)
- Test coverage for under-tested modules
- UI/UX polish (accessibility, responsive layout)

### Advanced

- New ADPL node types (requires spec extension in `docs/adpl-spec/`)
- Phase P engine improvements (Stages 1–7 internals)
- VS Code extension integration
- Multi-model routing strategies

## Reporting Issues

Please include:

- AutoDev version (`package.json → version`)
- Node.js and pnpm versions (`node -v && pnpm -v`)
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs from `~/.autodev/` or the browser console

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes following the code standards above
4. Run `pnpm verify:cross` — must pass with 95+/100
5. Submit your PR with:
   - A clear description of the change and why it is needed
   - Reference to any related issue
   - Your `verify:cross` score in the PR body

PRs that do not include a passing `verify:cross` score will be asked to add one before review.

## License

By contributing to AutoDev Agent, you agree that your contributions will be
licensed under the [MIT License](./LICENSE).

## Code of Conduct

Be respectful and constructive. We welcome contributors of all backgrounds and
experience levels. Harassment of any kind will not be tolerated.
