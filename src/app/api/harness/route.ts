import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadPrompt, loadMcpConfig, type PromptRole } from '@/lib/harness/prompt-loader';
import { NextResponse } from 'next/server';

// GET — load all harness files
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectDir = url.searchParams.get('projectDir') ?? undefined;

  const roles: PromptRole[] = ['planner', 'coder', 'verifier', 'evaluator'];

  const agents = roles.map(role => {
    const loaded = loadPrompt(role, projectDir);
    return {
      role,
      content: loaded.rawContent,
      source: loaded.source,
      filePath: loaded.filePath,
    };
  });

  const mcpConfig = loadMcpConfig(projectDir);

  return NextResponse.json({ agents, mcpConfig });
}

// POST — save a harness file
export async function POST(req: Request) {
  const body = await req.json();
  const { type, role, content, scope } = body;

  // Determine save path
  const baseDir = scope === 'project' && body.projectDir
    ? join(body.projectDir, '.autodev')
    : join(homedir(), '.autodev');

  if (type === 'agent') {
    const dir = join(baseDir, 'agents');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${role}.md`);
    writeFileSync(filePath, content, 'utf-8');
    try {
      appendFileSync(join(baseDir, 'harness-log.jsonl'), JSON.stringify({
        timestamp: new Date().toISOString(), action: 'edit',
        file: `agents/${role}.md`, scope: scope ?? 'global',
      }) + '\n');
    } catch { /* non-critical */ }
    return NextResponse.json({ success: true, filePath, scope: scope ?? 'global' });
  }

  if (type === 'mcp') {
    const dir = join(baseDir, 'mcp');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
    try {
      appendFileSync(join(baseDir, 'harness-log.jsonl'), JSON.stringify({
        timestamp: new Date().toISOString(), action: 'config',
        file: 'mcp/config.json', scope: scope ?? 'global',
      }) + '\n');
    } catch { /* non-critical */ }
    return NextResponse.json({ success: true, filePath, scope: scope ?? 'global' });
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
}

// DELETE — reset a harness file (delete override, fall back to default)
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const role = url.searchParams.get('role');
  const scope = url.searchParams.get('scope') ?? 'global';
  const projectDir = url.searchParams.get('projectDir');

  if (!role) return NextResponse.json({ error: 'role required' }, { status: 400 });

  const baseDir = scope === 'project' && projectDir
    ? join(projectDir, '.autodev')
    : join(homedir(), '.autodev');

  const filePath = join(baseDir, 'agents', `${role}.md`);

  if (existsSync(filePath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(filePath);
    try {
      appendFileSync(join(baseDir, 'harness-log.jsonl'), JSON.stringify({
        timestamp: new Date().toISOString(), action: 'reset',
        file: `agents/${role}.md`, scope,
      }) + '\n');
    } catch { /* non-critical */ }
    return NextResponse.json({ success: true, message: `Reset ${role} to default` });
  }

  return NextResponse.json({ success: true, message: 'Already using default' });
}
