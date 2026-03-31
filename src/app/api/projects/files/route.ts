import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get('dir');

  if (!dir) return NextResponse.json({ error: 'dir required' }, { status: 400 });

  if (dir.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  const resolved = resolve(dir);

  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    const EXCLUDE = new Set(['.git', 'node_modules', '.next', '.autodev', '.omc', '.omx', '.opencode', '.DS_Store']);

    const files = entries
      .filter(e => !EXCLUDE.has(e.name) && !e.name.startsWith('.'))
      .map(e => {
        const fullPath = join(resolved, e.name);
        if (e.isDirectory()) {
          return { name: e.name + '/', type: 'directory' as const };
        }
        try {
          const stat = statSync(fullPath);
          return { name: e.name, type: 'file' as const, size: stat.size };
        } catch {
          return { name: e.name, type: 'file' as const };
        }
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json(files);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
