import { NextResponse } from 'next/server';
import { resolveCli } from '@/lib/cli-resolver';

const AGENTS = [
  { id: 'claude-code', cliName: 'claude', displayName: 'Claude Code' },
  { id: 'codex-cli', cliName: 'codex', displayName: 'Codex CLI' },
  { id: 'gemini-cli', cliName: 'gemini', displayName: 'Gemini CLI' },
  { id: 'aider', cliName: 'aider', displayName: 'Aider' },
  { id: 'cline-cli', cliName: 'cline', displayName: 'Cline CLI' },
];

export async function GET() {
  const agents = await Promise.all(
    AGENTS.map(async (a) => {
      const path = await resolveCli(a.cliName);
      return {
        id: a.id,
        name: a.displayName,
        available: !!path,
        path,
      };
    })
  );

  // J2: Worker Pool status
  const maxWorkers = parseInt(process.env.AUTODEV_MAX_WORKERS ?? '3', 10);

  return NextResponse.json({
    agents,
    workerPool: {
      maxWorkers,
      configuredVia: process.env.AUTODEV_MAX_WORKERS ? 'AUTODEV_MAX_WORKERS' : 'default',
    },
    timestamp: new Date().toISOString(),
  });
}
