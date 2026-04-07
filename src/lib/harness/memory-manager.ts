import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

export interface ProjectMemory {
  projectSummary: string | null;
  techStack: string | null;
  decisions: string[];
  customNotes: Array<{ name: string; content: string }>;
}

const MEMORY_DIR = 'memory';

export function loadProjectMemory(projectDir: string): ProjectMemory {
  const memDir = join(projectDir, '.autodev', MEMORY_DIR);
  return {
    projectSummary: readMemoryFile(memDir, 'project-summary.md'),
    techStack: readMemoryFile(memDir, 'tech-stack.md'),
    decisions: readDecisions(memDir),
    customNotes: readCustomNotes(memDir),
  };
}

export function updateMemoryAfterTask(
  projectDir: string,
  taskPrompt: string,
  taskSummary: string,
  modifiedFiles: string[],
  techStack?: { type: string; framework?: string; language?: string },
): void {
  const memDir = join(projectDir, '.autodev', MEMORY_DIR);
  mkdirSync(memDir, { recursive: true });

  const summaryPath = join(memDir, 'project-summary.md');
  const existingSummary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf-8') : '';
  const newEntry = `\n- [${new Date().toISOString().slice(0, 10)}] ${taskPrompt.slice(0, 100)} → ${taskSummary.slice(0, 200)}`;
  const lines = existingSummary.split('\n');
  const trimmed = lines.length > 50 ? lines.slice(-50).join('\n') : existingSummary;
  writeFileSync(summaryPath, trimmed + newEntry, 'utf-8');

  if (techStack) {
    const techPath = join(memDir, 'tech-stack.md');
    if (!existsSync(techPath)) {
      const techContent = [
        `# Tech Stack`,
        `- Type: ${techStack.type}`,
        techStack.framework ? `- Framework: ${techStack.framework}` : null,
        techStack.language ? `- Language: ${techStack.language}` : null,
      ].filter(Boolean).join('\n');
      writeFileSync(techPath, techContent, 'utf-8');
    }
  }

  // modifiedFiles 파라미터는 향후 활용을 위해 보존 (현재는 summary에만 반영)
  void modifiedFiles;
}

export function addDecision(projectDir: string, decision: string): void {
  const memDir = join(projectDir, '.autodev', MEMORY_DIR);
  mkdirSync(memDir, { recursive: true });
  const decisionsPath = join(memDir, 'decisions.md');
  const existing = existsSync(decisionsPath) ? readFileSync(decisionsPath, 'utf-8') : '# Decisions\n';
  writeFileSync(decisionsPath, existing + `\n- [${new Date().toISOString().slice(0, 10)}] ${decision}`, 'utf-8');
}

export function formatMemoryForPrompt(memory: ProjectMemory): string {
  const sections: string[] = [];
  if (memory.techStack) sections.push(`### Tech Stack\n${memory.techStack}`);
  if (memory.projectSummary) {
    const lines = memory.projectSummary.split('\n').filter(l => l.trim());
    sections.push(`### Work History\n${lines.slice(-10).join('\n')}`);
  }
  if (memory.decisions.length > 0) sections.push(`### Key Decisions\n${memory.decisions.slice(-10).join('\n')}`);
  for (const note of memory.customNotes) {
    sections.push(`### ${note.name}\n${note.content.slice(0, 500)}`);
  }
  if (sections.length === 0) return '';
  return '\n\n## Project Memory\n' + sections.join('\n\n');
}

function readMemoryFile(memDir: string, filename: string): string | null {
  const filePath = join(memDir, filename);
  if (!existsSync(filePath)) return null;
  try { return readFileSync(filePath, 'utf-8').trim() || null; } catch { return null; }
}

function readDecisions(memDir: string): string[] {
  const content = readMemoryFile(memDir, 'decisions.md');
  if (!content) return [];
  return content.split('\n').filter(l => l.startsWith('- '));
}

function readCustomNotes(memDir: string): Array<{ name: string; content: string }> {
  if (!existsSync(memDir)) return [];
  try {
    return readdirSync(memDir)
      .filter(f => f.startsWith('custom-') && f.endsWith('.md'))
      .map(f => ({ name: basename(f, '.md').replace('custom-', ''), content: readFileSync(join(memDir, f), 'utf-8').trim() }))
      .filter(n => n.content);
  } catch { return []; }
}
