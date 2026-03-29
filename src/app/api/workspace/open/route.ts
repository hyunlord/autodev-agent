import { NextResponse } from 'next/server';
import { existsSync } from 'fs';

export async function POST(req: Request) {
  const { path } = await req.json();

  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  // Security: prevent path traversal (must check before existsSync)
  if (path.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
  }

  if (!existsSync(path)) {
    return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
  }

  try {
    const { execa } = await import('execa');

    if (process.platform === 'darwin') {
      await execa('open', [path]);
    } else if (process.platform === 'win32') {
      await execa('explorer', [path]);
    } else {
      await execa('xdg-open', [path]);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({
      error: `Failed to open: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 500 });
  }
}
