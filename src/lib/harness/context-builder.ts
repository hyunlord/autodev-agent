import { getExeca } from '../execa';
import { readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

export interface ProjectContext {
  // Git info
  gitBranch: string | null;
  gitStatus: string | null;        // short status (changed/staged/untracked)
  recentCommits: string | null;    // last 5 commits oneline
  changedFiles: string[];          // modified + staged + untracked

  // Project info
  projectTree: string;             // directory tree (depth 3)
  packageInfo: PackageInfo | null; // from package.json
  fileCount: number;

  // Context files
  readmeContent: string | null;    // README.md first 1000 chars
  autodevMemory: string | null;    // .autodev/ memory files

  // Previous work
  previousTaskSummary: string | null;
}

interface PackageInfo {
  name: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
}

/**
 * Build rich project context for Planning and Coding prompts.
 * Replaces the simple scanWorkspace find command.
 */
export async function buildProjectContext(
  projectDir: string,
  previousTaskSummary?: string,
): Promise<ProjectContext> {
  const execa = await getExeca();

  // Run git commands in parallel
  const [gitBranch, gitStatus, recentCommits, changedFiles, projectTree] = await Promise.all([
    // Current branch
    execa('git', ['branch', '--show-current'], { cwd: projectDir, reject: false, timeout: 5_000 })
      .then((r: any) => r.stdout.trim() || null)
      .catch(() => null),

    // Short status
    execa('git', ['status', '--short'], { cwd: projectDir, reject: false, timeout: 5_000 })
      .then((r: any) => r.stdout.trim() || null)
      .catch(() => null),

    // Last 5 commits
    execa('git', ['log', '--oneline', '-5'], { cwd: projectDir, reject: false, timeout: 5_000 })
      .then((r: any) => r.stdout.trim() || null)
      .catch(() => null),

    // Changed files (modified + staged + untracked)
    getChangedFiles(projectDir),

    // Directory tree
    buildTree(projectDir),
  ]);

  // Package info
  const packageInfo = readPackageInfo(projectDir);

  // File count
  let fileCount = 0;
  try {
    const result = await execa('find', [
      projectDir, '-maxdepth', '4', '-type', 'f',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.next/*',
    ], { reject: false, timeout: 5_000 });
    fileCount = result.stdout.trim().split('\n').filter(Boolean).length;
  } catch { /* ignore */ }

  // README
  const readmeContent = readFirstChars(join(projectDir, 'README.md'), 1000);

  // .autodev memory/notes
  const autodevMemory = readAutodevMemory(projectDir);

  return {
    gitBranch,
    gitStatus,
    recentCommits,
    changedFiles,
    projectTree,
    packageInfo,
    fileCount,
    readmeContent,
    autodevMemory,
    previousTaskSummary: previousTaskSummary ?? null,
  };
}

/**
 * Format ProjectContext into a string for prompt injection.
 */
export function formatContext(ctx: ProjectContext): string {
  const sections: string[] = [];

  // Git info
  if (ctx.gitBranch || ctx.gitStatus) {
    let git = '## Git Status\n';
    if (ctx.gitBranch) git += `Branch: ${ctx.gitBranch}\n`;
    if (ctx.gitStatus) {
      const statusLines = ctx.gitStatus.split('\n');
      if (statusLines.length > 20) {
        git += `Changed files: ${statusLines.length} files\n`;
        git += statusLines.slice(0, 10).join('\n') + '\n... (truncated)\n';
      } else {
        git += ctx.gitStatus + '\n';
      }
    }
    if (ctx.recentCommits) {
      git += `\nRecent commits:\n${ctx.recentCommits}\n`;
    }
    sections.push(git);
  }

  // Project structure
  if (ctx.projectTree) {
    sections.push(`## Project Structure (${ctx.fileCount} files)\n${ctx.projectTree}`);
  }

  // Dependencies
  if (ctx.packageInfo) {
    let deps = '## Dependencies\n';
    deps += `Package: ${ctx.packageInfo.name}\n`;
    if (ctx.packageInfo.scripts.length > 0) {
      deps += `Scripts: ${ctx.packageInfo.scripts.join(', ')}\n`;
    }
    if (ctx.packageInfo.dependencies.length > 0) {
      deps += `Dependencies: ${ctx.packageInfo.dependencies.join(', ')}\n`;
    }
    sections.push(deps);
  }

  // README
  if (ctx.readmeContent) {
    sections.push(`## README\n${ctx.readmeContent}`);
  }

  // .autodev memory
  if (ctx.autodevMemory) {
    sections.push(`## Project Notes (.autodev)\n${ctx.autodevMemory}`);
  }

  // Previous work
  if (ctx.previousTaskSummary) {
    sections.push(`## Previous Task\n${ctx.previousTaskSummary}`);
  }

  return sections.join('\n\n');
}

// ─── Helper functions ────────────────────────────────────

async function getChangedFiles(cwd: string): Promise<string[]> {
  try {
    const execa = await getExeca();
    const files: string[] = [];

    const { stdout: unstaged } = await execa('git', ['diff', '--name-only'], { cwd, reject: false });
    files.push(...unstaged.split('\n').filter(Boolean));

    const { stdout: staged } = await execa('git', ['diff', '--name-only', '--cached'], { cwd, reject: false });
    files.push(...staged.split('\n').filter(Boolean));

    const { stdout: untracked } = await execa('git', ['ls-files', '--others', '--exclude-standard'], { cwd, reject: false });
    files.push(...untracked.split('\n').filter(Boolean));

    return [...new Set(files)];
  } catch {
    return [];
  }
}

async function buildTree(projectDir: string): Promise<string> {
  try {
    const execa = await getExeca();

    // Try tree command first
    const { stdout, exitCode } = await execa('tree', [
      projectDir, '-L', '3', '--noreport',
      '-I', 'node_modules|.git|.next|.autodev|.omc|.omx|.opencode',
    ], { reject: false, timeout: 5_000 });

    if (exitCode === 0 && stdout.trim()) {
      const lines = stdout.trim().split('\n');
      if (lines.length > 50) {
        return lines.slice(0, 50).join('\n') + '\n... (truncated)';
      }
      return stdout.trim();
    }
  } catch { /* tree not installed */ }

  // Fallback: find-based listing
  try {
    const execa = await getExeca();
    const { stdout } = await execa('find', [
      projectDir, '-maxdepth', '3', '-type', 'f',
      '-not', '-path', '*/.git/*',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.next/*',
      '-not', '-path', '*/.autodev/*',
      '-not', '-path', '*/.omc/*',
      '-not', '-path', '*/.omx/*',
    ], { reject: false, timeout: 5_000 });

    const files = stdout.trim().split('\n')
      .map((f: string) => relative(projectDir, f))
      .filter((f: string) => f && !f.startsWith('.'))
      .sort()
      .slice(0, 50);

    return files.map((f: string) => `- ${f}`).join('\n');
  } catch {
    return '(unable to scan)';
  }
}

function readPackageInfo(projectDir: string): PackageInfo | null {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return {
      name: pkg.name ?? 'unknown',
      dependencies: Object.keys(pkg.dependencies ?? {}).slice(0, 20),
      devDependencies: Object.keys(pkg.devDependencies ?? {}).slice(0, 10),
      scripts: Object.keys(pkg.scripts ?? {}),
    };
  } catch {
    return null;
  }
}

function readFirstChars(filePath: string, maxChars: number): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.slice(0, maxChars);
  } catch {
    return null;
  }
}

function readAutodevMemory(projectDir: string): string | null {
  const autodevDir = join(projectDir, '.autodev');
  if (!existsSync(autodevDir)) return null;

  const notes: string[] = [];

  // Read project-name.txt
  const nameFile = join(autodevDir, 'project-name.txt');
  if (existsSync(nameFile)) {
    try { notes.push(`Project: ${readFileSync(nameFile, 'utf-8').trim()}`); } catch { /* ignore */ }
  }

  // Read config.yaml if exists
  const configFile = join(autodevDir, 'config.yaml');
  if (existsSync(configFile)) {
    try { notes.push(`Config:\n${readFileSync(configFile, 'utf-8').slice(0, 500)}`); } catch { /* ignore */ }
  }

  return notes.length > 0 ? notes.join('\n') : null;
}
