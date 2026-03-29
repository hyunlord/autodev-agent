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

  // Security: prevent path traversal in file path
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 403 });
  }

  const resolvedDir = resolve(projectDir);
  const fullPath = resolve(join(projectDir, filePath));

  // Ensure the resolved path is inside the project directory (no traversal)
  if (!fullPath.startsWith(resolvedDir)) {
    return NextResponse.json({ error: 'Path traversal detected' }, { status: 403 });
  }

  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = statSync(fullPath);

  if (stat.size > 1_000_000) {
    return NextResponse.json({ error: 'File too large (max 1MB)' }, { status: 413 });
  }

  try {
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
  } catch {
    return NextResponse.json({ error: 'Failed to read file (may be binary)' }, { status: 422 });
  }
}
