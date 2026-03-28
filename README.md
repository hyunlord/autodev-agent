# AutoDev Agent

Universal AI Development Agent Orchestrator

> Plan → Code → Verify → Retry — fully automated, locally hosted.

## Quick Start

### Option 1: Docker (recommended for trying out)

```bash
docker compose up
```

Open [http://localhost:3000](http://localhost:3000)

> **Note:** Docker runs in Manual planning mode by default. The `claude` CLI is not installed inside the container. To use Auto or API modes, run locally instead.

### Option 2: Local Development

**Prerequisites:** Node.js 18+, pnpm

```bash
# Install dependencies
pnpm install

# Install Playwright browser
npx playwright install chromium

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

### First Run

1. Open the dashboard at `http://localhost:3000`
2. (Optional) Go to `/setup` to configure API keys
3. Create a task — choose a planning mode:
   - **Auto**: Uses `claude` CLI (requires `claude login`)
   - **Manual**: Paste your own coding prompt + checklist
   - **API**: Uses Claude API directly (requires API key)

## Architecture

```
Browser (localhost:3000)
  │ SSE (real-time progress)
  ▼
Next.js Server (API Routes)
  │ IPC
  ▼
Worker Process
  ├── Planning (CLI auto / Manual / API)
  ├── Coding (Claude Code CLI)
  └── Verification
       ├── Build check (exit code)
       ├── Port check (TCP)
       ├── HTTP check (status)
       ├── DOM check (Playwright)
       └── VLM check (screenshot → CLI)
```

## License

MIT
