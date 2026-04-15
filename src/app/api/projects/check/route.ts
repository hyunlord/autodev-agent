import { existsSync } from 'fs';
import { join } from 'path';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get('dir');
  if (!dir) return NextResponse.json({ error: 'dir required' }, { status: 400 });

  // Path traversal prevention
  const resolved = resolve(dir);
  if (resolved !== dir && !dir.startsWith('/')) {
    return NextResponse.json({ error: 'absolute path required' }, { status: 400 });
  }

  const hasConfig = existsSync(join(resolved, '.autodev'));
  const hasAgents = existsSync(join(resolved, '.autodev', 'agents'));
  const hasHooks = existsSync(join(resolved, '.autodev', 'hooks.json'));
  const hasPipelineConfig = existsSync(join(resolved, '.autodev', 'pipeline-config.json'));

  return NextResponse.json({ hasConfig, hasAgents, hasHooks, hasPipelineConfig });
}
