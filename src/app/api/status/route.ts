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

  return NextResponse.json({
    agents,
    timestamp: new Date().toISOString(),
  });
}
