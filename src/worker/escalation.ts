import type { AttemptRecord } from './retry';

export interface EscalationData {
  taskId: string;
  prompt: string;
  summary: string;
  attempts: AttemptRecord[];
  failedChecks: Array<{ id: string; description: string; actual?: string }>;
  totalCostUsd: number;
  totalDurationMs: number;
  stopReason: string;
  modifiedFiles: string[];
}

export function generateEscalationReport(data: EscalationData): string {
  const attemptRows = data.attempts.map(a =>
    `| ${a.attemptNum} | ${a.errorMessage.slice(0, 80)}${a.errorMessage.length > 80 ? '...' : ''} | ${a.tokensUsed.toLocaleString()} | ${(a.durationMs / 1000).toFixed(1)}s |`
  ).join('\n');

  const failedRows = data.failedChecks.map(c =>
    `- **${c.description}**: ${c.actual ?? 'no detail'}`
  ).join('\n');

  return `# Escalation Report

## Task
${data.prompt}

## Summary
${data.summary}

## Stop Reason
**${data.stopReason}** after ${data.attempts.length} attempt(s)

## Attempt History
| # | Error | Tokens | Duration |
|---|-------|--------|----------|
${attemptRows}

## Failed Verification Checks
${failedRows}

## Modified Files
${data.modifiedFiles.length > 0 ? data.modifiedFiles.map(f => `- ${f}`).join('\n') : 'None'}

## Cost
$${data.totalCostUsd.toFixed(4)} total across ${data.attempts.length} attempt(s)

## Duration
${(data.totalDurationMs / 1000).toFixed(1)} seconds total

## Suggested Next Steps
- Review the failed checks above
- Check if the task description is clear enough
- Try a different approach or break the task into smaller pieces
- Consider using Manual mode with a more specific coding prompt
`;
}
