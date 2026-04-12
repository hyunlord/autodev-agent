/**
 * K8: 계층적 지침 탐색
 *
 * 프로젝트 루트 → 작업 디렉토리까지 AGENTS.md / CLAUDE.md / .autodev/INSTRUCTIONS.md 수집 + 병합.
 * 하위 디렉토리별 에이전트 지침을 계층적으로 로드하여 프롬프트에 주입.
 */

import { resolve, relative, join } from 'path';
import { existsSync, readFileSync } from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstructionFile {
  /** Absolute path to the instruction file */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** Depth from project root (0 = root) */
  depth: number;
  /** File content (truncated to MAX_CONTENT_LENGTH) */
  content: string;
  /** Which filename pattern matched */
  source: 'AGENTS.md' | 'CLAUDE.md' | '.autodev/INSTRUCTIONS.md';
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Priority order: first match in a directory wins */
const INSTRUCTION_FILENAMES: Array<{ file: string; subdir?: string; source: InstructionFile['source'] }> = [
  { file: 'AGENTS.md', source: 'AGENTS.md' },
  { file: 'CLAUDE.md', source: 'CLAUDE.md' },
  { file: 'INSTRUCTIONS.md', subdir: '.autodev', source: '.autodev/INSTRUCTIONS.md' },
];

/** Max content length per file to prevent prompt bloat */
const MAX_CONTENT_LENGTH = 4000;

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Scan a single directory for instruction files.
 * Returns the first match by priority order (only one per directory).
 */
function scanDirectory(dir: string, rootDir: string): InstructionFile | null {
  for (const entry of INSTRUCTION_FILENAMES) {
    const filePath = entry.subdir
      ? join(dir, entry.subdir, entry.file)
      : join(dir, entry.file);

    if (existsSync(filePath)) {
      try {
        let content = readFileSync(filePath, 'utf-8');
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.slice(0, MAX_CONTENT_LENGTH) + '\n...(truncated)';
        }

        const relPath = relative(rootDir, dir) || '.';
        const depth = relPath === '.' ? 0 : relPath.split('/').length;

        return {
          path: filePath,
          relativePath: relative(rootDir, filePath),
          depth,
          content,
          source: entry.source,
        };
      } catch {
        // Read failed — skip this file
        continue;
      }
    }
  }
  return null;
}

/**
 * Collect instruction files from projectDir root down to workingDir.
 * If workingDir is not provided, only scans the root directory.
 */
export function collectInstructions(projectDir: string, workingDir?: string): InstructionFile[] {
  const root = resolve(projectDir);
  const target = workingDir ? resolve(workingDir) : root;

  // Validate: target must be under root
  if (!target.startsWith(root)) {
    return [];
  }

  const instructions: InstructionFile[] = [];

  // Walk from root to target directory
  const segments = relative(root, target).split('/').filter(Boolean);
  let currentDir = root;

  // Scan root first
  const rootInstruction = scanDirectory(currentDir, root);
  if (rootInstruction) {
    instructions.push(rootInstruction);
  }

  // Scan each directory on the path to target
  for (const segment of segments) {
    currentDir = join(currentDir, segment);
    const instruction = scanDirectory(currentDir, root);
    if (instruction) {
      instructions.push(instruction);
    }
  }

  return instructions;
}

/**
 * Merge collected instructions into a single prompt section.
 * depth 0 → "Project instructions", deeper → "Directory instructions (path)".
 */
export function mergeInstructions(instructions: InstructionFile[]): string {
  if (instructions.length === 0) return '';

  const sections: string[] = [];

  for (const inst of instructions) {
    const header = inst.depth === 0
      ? `## Project instructions (${inst.source})`
      : `## Directory instructions: ${inst.relativePath}`;
    sections.push(`${header}\n${inst.content}`);
  }

  return '\n\n# Hierarchical Instructions\n' + sections.join('\n\n');
}
