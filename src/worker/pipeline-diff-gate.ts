import type { EmitFn } from './pipeline-types';
import type { PipelineEvent } from '../lib/types';

export interface DiffGateConfig {
  maxFilesChanged: number;
  maxLinesChanged: number;
  forbiddenPaths: string[];
  maxFileSizeKb: number;
}

export interface DiffGateResult {
  passed: boolean;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    totalLines: number;
  };
  violations: string[];
}

const DEFAULT_CONFIG: DiffGateConfig = {
  maxFilesChanged: 50,
  maxLinesChanged: 5000,
  forbiddenPaths: [
    '.env', '.env.local', '.env.production',
    '.git/',
  ],
  maxFileSizeKb: 500,
};

/**
 * J4: Diff Gate — validate git diff before accepting coding result.
 *
 * Runs after coding, before verification. Rejects if the diff is
 * suspiciously large, touches forbidden files, or produces oversized files.
 */
export async function runDiffGate(
  projectDir: string,
  emit: EmitFn,
  config?: Partial<DiffGateConfig>,
): Promise<DiffGateResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const violations: string[] = [];

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();

  try {
    // Numstat for precise line counts
    const { stdout: numstat } = await execa(
      'git', ['diff', '--numstat', 'HEAD'],
      { cwd: projectDir, reject: false, timeout: 15_000 },
    ) as { stdout: string };

    // Untracked files
    const { stdout: untrackedRaw } = await execa(
      'git', ['ls-files', '--others', '--exclude-standard'],
      { cwd: projectDir, reject: false, timeout: 10_000 },
    ) as { stdout: string };
    const untrackedFiles = untrackedRaw.trim().split('\n').filter(Boolean);

    const lines = numstat.trim().split('\n').filter(Boolean);
    let totalInsertions = 0;
    let totalDeletions = 0;
    const changedFiles: string[] = [];

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const ins = parseInt(parts[0]) || 0;
        const del = parseInt(parts[1]) || 0;
        totalInsertions += ins;
        totalDeletions += del;
        changedFiles.push(parts[2]);
      }
    }

    const allFiles = [...new Set([...changedFiles, ...untrackedFiles])];
    const filesChanged = allFiles.length;
    const totalLines = totalInsertions + totalDeletions;

    if (filesChanged === 0 && untrackedFiles.length === 0) {
      return {
        passed: true,
        stats: { filesChanged: 0, insertions: 0, deletions: 0, totalLines: 0 },
        violations: [],
      };
    }

    // Check: too many files
    if (filesChanged > cfg.maxFilesChanged) {
      violations.push(`Too many files changed: ${filesChanged} (max: ${cfg.maxFilesChanged})`);
    }

    // Check: too many lines
    if (totalLines > cfg.maxLinesChanged) {
      violations.push(`Too many lines changed: ${totalLines} (max: ${cfg.maxLinesChanged})`);
    }

    // Check: forbidden paths
    for (const file of allFiles) {
      for (const forbidden of cfg.forbiddenPaths) {
        if (file === forbidden || file.startsWith(forbidden)) {
          violations.push(`Forbidden file modified: ${file}`);
        }
      }
    }

    // Check: oversized files
    const { statSync } = await import('fs');
    const { join } = await import('path');
    for (const file of allFiles) {
      try {
        const stat = statSync(join(projectDir, file));
        const sizeKb = stat.size / 1024;
        if (sizeKb > cfg.maxFileSizeKb) {
          violations.push(`File too large: ${file} (${Math.round(sizeKb)}KB > ${cfg.maxFileSizeKb}KB)`);
        }
      } catch {
        // File may have been deleted — OK
      }
    }

    const stats = { filesChanged, insertions: totalInsertions, deletions: totalDeletions, totalLines };
    const passed = violations.length === 0;

    if (!passed) {
      emit({ type: 'log', level: 'warn',
        message: `[Diff Gate] BLOCKED — ${violations.join('; ')}` } as PipelineEvent);
    } else {
      emit({ type: 'log', level: 'info',
        message: `[Diff Gate] Passed — ${filesChanged} files, +${totalInsertions}/-${totalDeletions}` } as PipelineEvent);
    }

    return { passed, stats, violations };
  } catch (err) {
    // Not a git repo or other error — pass through
    emit({ type: 'log', level: 'warn',
      message: `[Diff Gate] Skipped: ${err}` } as PipelineEvent);
    return {
      passed: true,
      stats: { filesChanged: 0, insertions: 0, deletions: 0, totalLines: 0 },
      violations: [],
    };
  }
}
