import { readFileSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectDir = url.searchParams.get('projectDir');
  const filePath = url.searchParams.get('file');

  if (!projectDir || !filePath) {
    return NextResponse.json({ error: 'projectDir and file are required' }, { status: 400 });
  }

  // Security: validate projectDir is within allowed workspace root
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? (process.env.HOME ? `${process.env.HOME}/.autodev/workspaces` : '/tmp/autodev-workspaces');
  if (!resolve(projectDir).startsWith(resolve(workspaceRoot))) {
    return NextResponse.json({ error: 'Forbidden: projectDir outside workspace root' }, { status: 403 });
  }

  // Security: prevent path traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 403 });
  }

  const fullPath = resolve(join(projectDir, filePath));

  // Ensure the resolved path is still inside the project directory
  if (!fullPath.startsWith(resolve(projectDir))) {
    return NextResponse.json({ error: 'Path traversal detected' }, { status: 403 });
  }

  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = statSync(fullPath);

  // Don't serve files larger than 1MB
  if (stat.size > 1_000_000) {
    return NextResponse.json({ error: 'File too large (max 1MB)' }, { status: 413 });
  }

  const content = readFileSync(fullPath, 'utf-8');

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const languageMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', html: 'html', css: 'css',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    toml: 'toml', sh: 'shell', bash: 'shell', gd: 'gdscript',
  };

  return NextResponse.json({
    path: filePath,
    content,
    language: languageMap[ext] ?? 'text',
    size: stat.size,
  });
}
