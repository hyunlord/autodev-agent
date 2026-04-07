import { NextResponse } from 'next/server';
import { resolve } from 'path';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectDir = url.searchParams.get('projectDir');
  const file = url.searchParams.get('file');
  const ref = url.searchParams.get('ref') ?? '';

  if (!projectDir) {
    return NextResponse.json({ error: 'projectDir is required' }, { status: 400 });
  }

  const resolvedDir = resolve(projectDir);

  try {
    const { getExeca } = await import('@/lib/execa');
    const execa = await getExeca();

    if (file && file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 403 });
    }

    // If a specific commit is requested, show that commit's diff
    const commit = url.searchParams.get('commit');
    if (commit && /^[0-9a-f]{7,40}$/i.test(commit)) {
      const showArgs = ['show', '--no-color', '-U3', commit, '--'];
      if (file) showArgs.push(file);
      const { stdout } = await execa('git', showArgs, {
        cwd: resolvedDir, reject: false, timeout: 10_000,
      }) as { stdout: string };
      const fileDiffs = parseDiff(stdout);
      return NextResponse.json({ files: fileDiffs, totalFiles: fileDiffs.length, raw: stdout.slice(0, 500_000) });
    }

    const args = ['diff', '--no-color', '-U3'];
    if (ref) args.push(ref);
    args.push('--');
    if (file) args.push(file);

    const { stdout: diffOutput } = await execa('git', args, {
      cwd: resolvedDir, reject: false, timeout: 10_000,
    }) as { stdout: string };

    const stagedArgs = ['diff', '--cached', '--no-color', '-U3'];
    if (ref) stagedArgs.push(ref);
    stagedArgs.push('--');
    if (file) stagedArgs.push(file);

    const { stdout: stagedOutput } = await execa('git', stagedArgs, {
      cwd: resolvedDir, reject: false, timeout: 10_000,
    }) as { stdout: string };

    let untrackedDiff = '';
    if (!ref) {
      const { stdout: untracked } = await execa('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: resolvedDir, reject: false, timeout: 5_000,
      }) as { stdout: string };
      const untrackedFiles = untracked.split('\n').filter(Boolean);

      if (file) {
        if (untrackedFiles.includes(file)) {
          const { readFileSync } = await import('fs');
          const { join } = await import('path');
          try {
            const content = readFileSync(join(resolvedDir, file), 'utf-8');
            const lines = content.split('\n');
            untrackedDiff = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}`;
          } catch { /* skip binary */ }
        }
      } else {
        for (const uf of untrackedFiles.slice(0, 20)) {
          const { readFileSync, statSync } = await import('fs');
          const { join } = await import('path');
          const fullPath = join(resolvedDir, uf);
          try {
            const stat = statSync(fullPath);
            if (stat.size > 100_000) continue;
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            untrackedDiff += `\ndiff --git a/${uf} b/${uf}\nnew file mode 100644\n--- /dev/null\n+++ b/${uf}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}\n`;
          } catch { /* skip */ }
        }
      }
    }

    const combined = [diffOutput, stagedOutput, untrackedDiff].filter(Boolean).join('\n');
    const fileDiffs = parseDiff(combined);

    return NextResponse.json({
      files: fileDiffs,
      totalFiles: fileDiffs.length,
      raw: combined.slice(0, 500_000),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get diff';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface FileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  hunks: Array<{
    header: string;
    lines: Array<{
      type: 'context' | 'add' | 'remove';
      content: string;
      oldLine?: number;
      newLine?: number;
    }>;
  }>;
  additions: number;
  deletions: number;
}

function parseDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return [];
  const files: FileDiff[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;
    const path = headerMatch[2];

    let status: FileDiff['status'] = 'modified';
    if (section.includes('new file mode')) status = 'added';
    else if (section.includes('deleted file mode')) status = 'deleted';

    const hunks: FileDiff['hunks'] = [];
    let additions = 0;
    let deletions = 0;
    let currentHunk: FileDiff['hunks'][0] | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        oldLine = parseInt(hunkMatch[1]);
        newLine = parseInt(hunkMatch[2]);
        currentHunk = { header: line, lines: [] };
        continue;
      }
      if (!currentHunk) continue;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ });
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++ });
        deletions++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    files.push({ path, status, hunks, additions, deletions });
  }
  return files;
}
