import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectDir = url.searchParams.get('projectDir');

  const logPaths: string[] = [];

  // Global log
  const globalLog = join(homedir(), '.autodev', 'harness-log.jsonl');
  if (existsSync(globalLog)) logPaths.push(globalLog);

  // Project log
  if (projectDir) {
    const projectLog = join(projectDir, '.autodev', 'harness-log.jsonl');
    if (existsSync(projectLog)) logPaths.push(projectLog);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: any[] = [];
  for (const p of logPaths) {
    const lines = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { continue; }
    }
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json(entries.slice(0, 50));
}
