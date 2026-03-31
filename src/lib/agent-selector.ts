import { PluginRegistry } from './plugins/registry';
import type { ICodingAgent } from './plugins/interfaces';

export type TaskCategory =
  | 'quick-fix'
  | 'html-css'
  | 'full-stack'
  | 'refactor'
  | 'new-project'
  | 'debug'
  | 'docs'
  | 'unknown';

// Agent preference order per category (first available wins)
const CATEGORY_AGENTS: Record<TaskCategory, string[]> = {
  'quick-fix':   ['gemini-cli', 'claude-code', 'codex-cli', 'aider', 'cline-cli'],
  'html-css':    ['claude-code', 'gemini-cli', 'codex-cli', 'aider', 'cline-cli'],
  'full-stack':  ['claude-code', 'codex-cli', 'gemini-cli', 'aider', 'cline-cli'],
  'refactor':    ['claude-code', 'aider', 'codex-cli', 'gemini-cli', 'cline-cli'],
  'new-project': ['claude-code', 'gemini-cli', 'codex-cli', 'aider', 'cline-cli'],
  'debug':       ['claude-code', 'codex-cli', 'gemini-cli', 'aider', 'cline-cli'],
  'docs':        ['gemini-cli', 'claude-code', 'codex-cli', 'aider', 'cline-cli'],
  'unknown':     ['claude-code', 'gemini-cli', 'codex-cli', 'aider', 'cline-cli'],
};

// Keywords for category detection
const CATEGORY_KEYWORDS: Array<{ category: TaskCategory; keywords: string[]; weight: number }> = [
  { category: 'quick-fix', keywords: ['fix typo', 'rename', 'change text', 'update string', 'change color', 'change value', '오타', '수정', '변경'], weight: 2 },
  { category: 'html-css', keywords: ['html', 'css', 'style', 'button', 'layout', 'responsive', 'dark mode', 'toggle', 'animation', 'hover', '페이지', '디자인', '스타일', 'UI', 'ui'], weight: 2 },
  { category: 'full-stack', keywords: ['api', 'database', 'backend', 'frontend', 'full-stack', 'fullstack', 'server', 'client', 'auth', 'login', '풀스택', '서버', '인증'], weight: 3 },
  { category: 'refactor', keywords: ['refactor', 'restructure', 'reorganize', 'clean up', 'simplify', 'optimize', 'performance', '리팩토링', '정리', '최적화'], weight: 2 },
  { category: 'debug', keywords: ['bug', 'error', 'fix', 'crash', 'broken', 'not working', 'debug', 'issue', '버그', '에러', '오류', '안됨', '안 됨'], weight: 2 },
  { category: 'docs', keywords: ['readme', 'documentation', 'comment', 'jsdoc', 'docs', '문서', '주석', '설명'], weight: 2 },
  { category: 'new-project', keywords: ['create', 'make', 'build', 'new', 'generate', 'scaffold', '만들어', '생성', '새로'], weight: 1 },
];

export function detectTaskCategory(taskPrompt: string, projectType?: string): TaskCategory {
  const lower = taskPrompt.toLowerCase();
  const scores: Record<TaskCategory, number> = {
    'quick-fix': 0, 'html-css': 0, 'full-stack': 0,
    'refactor': 0, 'new-project': 0, 'debug': 0, 'docs': 0, 'unknown': 0,
  };

  for (const { category, keywords, weight } of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        scores[category] += weight;
      }
    }
  }

  // Project type boost
  if (projectType === 'static-html') {
    scores['html-css'] += 3;
  }
  if (projectType === 'nextjs' || projectType === 'react' || projectType === 'vite') {
    scores['full-stack'] += 2;
  }

  let best: TaskCategory = 'unknown';
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = cat as TaskCategory;
    }
  }

  return best;
}

export async function selectBestAgent(
  category: TaskCategory,
  preferredAgentId?: string | null,
): Promise<{ agent: ICodingAgent; agentId: string; category: TaskCategory; autoSelected: boolean }> {
  // If user explicitly selected an agent (not 'auto'), use it
  if (preferredAgentId && preferredAgentId !== 'auto') {
    const preferred = PluginRegistry.instance.getAgent(preferredAgentId);
    if (preferred && await preferred.isAvailable()) {
      return { agent: preferred, agentId: preferred.id, category, autoSelected: false };
    }
  }

  // Auto-select based on category
  const preferenceOrder = CATEGORY_AGENTS[category] ?? CATEGORY_AGENTS['unknown'];

  for (const agentId of preferenceOrder) {
    const agent = PluginRegistry.instance.getAgent(agentId);
    if (agent && await agent.isAvailable()) {
      return { agent, agentId: agent.id, category, autoSelected: true };
    }
  }

  // Absolute fallback: any available agent
  const all = PluginRegistry.instance.listAgents();
  for (const agent of all) {
    if (await agent.isAvailable()) {
      return { agent, agentId: agent.id, category, autoSelected: true };
    }
  }

  throw new Error('No coding agents available');
}
