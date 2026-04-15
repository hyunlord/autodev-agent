interface PlanTask {
  description: string;
  files?: string[];
  agent?: string;
}

interface Plan {
  summary: string;
  tasks?: PlanTask[];
  estimatedFiles?: string[];
  steps?: Array<{ description: string; files?: string[] }>;
  codingPrompt?: string;
}

export function planToMermaid(plan: Plan): string {
  const lines: string[] = ['graph TD'];
  const summary = plan.summary ?? 'Task';
  lines.push(`  START(["🎯 ${wrapText(escapeMermaid(summary), 5, 40)}"])`);

  const tasks = plan.tasks ?? plan.steps ?? [];

  if (tasks.length === 0) {
    // tasks 배열이 없으면 codingPrompt에서 단계를 추출
    const steps = extractStepsFromPrompt(plan.codingPrompt ?? '');
    if (steps.length > 0) {
      steps.forEach((step, i) => {
        const id = `T${i + 1}`;
        lines.push(`  ${id}["${i + 1}. ${wrapText(escapeMermaid(step), 5, 50)}"]`);
        lines.push(i === 0 ? `  START --> ${id}` : `  T${i} --> ${id}`);
      });
      lines.push(`  T${steps.length} --> DONE(["✅ Complete"])`);
      lines.push('  style START fill:#7c3aed,color:#fff,stroke:#7c3aed');
      lines.push('  style DONE fill:#10b981,color:#fff,stroke:#10b981');
      for (let i = 1; i <= steps.length; i++) {
        lines.push(`  style T${i} fill:#1e293b,color:#e2e8f0,stroke:#6366f1`);
      }
    } else {
      // 정말 아무것도 없으면 단일 노드
      const label = wrapText(escapeMermaid((plan.codingPrompt ?? summary)), 5, 60);
      lines.push(`  TASK["📝 ${label}"]`);
      lines.push(`  START --> TASK --> DONE(["✅ Complete"])`);
      lines.push('  style START fill:#7c3aed,color:#fff,stroke:#7c3aed');
      lines.push('  style DONE fill:#10b981,color:#fff,stroke:#10b981');
      lines.push('  style TASK fill:#1e293b,color:#e2e8f0,stroke:#6366f1');
    }
  } else {
    tasks.forEach((task, i) => {
      const id = `T${i + 1}`;
      const desc = wrapText(escapeMermaid(task.description), 5, 50);
      const files = task.files?.length ? `<br/>📁 ${task.files.join(', ').slice(0, 40)}` : '';
      lines.push(`  ${id}["${i + 1}. ${desc}${files}"]`);
      lines.push(i === 0 ? `  START --> ${id}` : `  T${i} --> ${id}`);
    });
    lines.push(`  T${tasks.length} --> DONE(["✅ Complete"])`);

    // 파일 노드 추가 (estimatedFiles가 있으면)
    if (plan.estimatedFiles && plan.estimatedFiles.length > 0) {
      const filesList = escapeMermaid(plan.estimatedFiles.slice(0, 5).join(', '));
      lines.push(`  FILES[/"📁 ${filesList}"/]`);
      lines.push(`  DONE -.-> FILES`);
      lines.push(`  style FILES fill:#1e293b,color:#94a3b8,stroke:#475569`);
    }

    lines.push('  style START fill:#7c3aed,color:#fff,stroke:#7c3aed');
    lines.push('  style DONE fill:#10b981,color:#fff,stroke:#10b981');
    for (let i = 1; i <= tasks.length; i++) {
      lines.push(`  style T${i} fill:#1e293b,color:#e2e8f0,stroke:#6366f1`);
    }
  }

  return lines.join('\n');
}

/**
 * codingPrompt에서 번호 매긴 단계를 추출 ("1. ...\n2. ...\n3. ..." 패턴)
 */
function extractStepsFromPrompt(prompt: string): string[] {
  const steps: string[] = [];
  for (const line of prompt.split('\n')) {
    const match = line.match(/^\s*\d+\.\s+(.+)/);
    if (match) {
      const stepText = match[1].trim();
      if (stepText.length >= 10) steps.push(stepText);
    }
  }
  return steps.slice(0, 10);
}

function escapeMermaid(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()#<>]/g, ' ');
}

/** Wrap long text into multiple lines using <br/> for Mermaid htmlLabels */
function wrapText(text: string, wordsPerLine: number = 5, maxLen: number = 50): string {
  const trimmed = text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  const words = trimmed.split(' ');
  if (words.length <= wordsPerLine) return trimmed;
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(' '));
  }
  return lines.join('<br/>');
}
