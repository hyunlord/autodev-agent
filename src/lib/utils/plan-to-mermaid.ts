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
}

export function planToMermaid(plan: Plan): string {
  const lines: string[] = ['graph TD'];
  const summary = plan.summary ?? 'Task';
  lines.push(`  START(["🎯 ${escapeMermaid(summary.slice(0, 60))}"])`);

  const tasks = plan.tasks ?? plan.steps ?? [];
  tasks.forEach((task, i) => {
    const id = `T${i + 1}`;
    const desc = escapeMermaid(task.description.slice(0, 80));
    const files = task.files?.length ? `<br/>📁 ${task.files.length} files` : '';
    lines.push(`  ${id}["${i + 1}. ${desc}${files}"]`);
    lines.push(i === 0 ? `  START --> ${id}` : `  T${i} --> ${id}`);
  });

  if (tasks.length > 0) {
    lines.push(`  T${tasks.length} --> DONE(["✅ Complete"])`);
  }

  lines.push('  style START fill:#7c3aed,color:#fff');
  lines.push('  style DONE fill:#10b981,color:#fff');
  return lines.join('\n');
}

function escapeMermaid(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()#]/g, ' ');
}
