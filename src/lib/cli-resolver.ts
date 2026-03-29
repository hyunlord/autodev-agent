import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function getNodePaths(bin: string): string[] {
  const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
  const paths: string[] = [];
  try {
    const versions = readdirSync(nvmDir);
    for (const v of versions) {
      paths.push(join(nvmDir, v, 'bin', bin));
    }
  } catch { /* nvm not installed */ }
  return paths;
}

const COMMON_PATHS: Record<string, string[]> = {
  claude: [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.npm-global', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    ...getNodePaths('claude'),
    '/opt/homebrew/bin/claude',
    join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
  ],
  gemini: [
    join(homedir(), '.local', 'bin', 'gemini'),
    join(homedir(), '.npm-global', 'bin', 'gemini'),
    '/usr/local/bin/gemini',
    '/opt/homebrew/bin/gemini',
  ],
  codex: [
    join(homedir(), '.local', 'bin', 'codex'),
    join(homedir(), '.npm-global', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
  ],
  aider: [
    join(homedir(), '.local', 'bin', 'aider'),
    '/usr/local/bin/aider',
    '/opt/homebrew/bin/aider',
    join(homedir(), '.local', 'pipx', 'venvs', 'aider-chat', 'bin', 'aider'),
  ],
  cline: [
    join(homedir(), '.local', 'bin', 'cline'),
    join(homedir(), '.npm-global', 'bin', 'cline'),
    '/usr/local/bin/cline',
    '/opt/homebrew/bin/cline',
  ],
};

const resolveCache = new Map<string, string | null>();

function augmentedPath(): string {
  const base = process.env.PATH ?? '';
  const extra = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(homedir(), 'bin'),
  ];
  return [...extra, ...base.split(process.platform === 'win32' ? ';' : ':')].join(
    process.platform === 'win32' ? ';' : ':'
  );
}

export async function resolveCli(name: string): Promise<string | null> {
  if (resolveCache.has(name)) {
    return resolveCache.get(name)!;
  }

  try {
    const { getExeca } = await import('./execa');
    const execa = await getExeca();
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execa(cmd, [name], {
      reject: false,
      timeout: 5_000,
      env: { ...process.env, PATH: augmentedPath() },
    });
    const resolved = stdout.trim().split('\n')[0];
    if (resolved && existsSync(resolved)) {
      resolveCache.set(name, resolved);
      return resolved;
    }
  } catch { /* which/where failed */ }

  const paths = COMMON_PATHS[name] ?? [];
  for (const p of paths) {
    if (existsSync(p)) {
      resolveCache.set(name, p);
      return p;
    }
  }

  resolveCache.set(name, null);
  return null;
}

export function clearCliCache(): void {
  resolveCache.clear();
}
