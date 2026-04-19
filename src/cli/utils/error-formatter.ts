import { ZodIssue, ZodIssueCode } from 'zod';

export interface FormattedError {
  path: string;
  message: string;
  currentValue?: unknown;
  suggestion?: string;
}

export function formatError(issue: ZodIssue): FormattedError {
  return {
    path: formatPath(issue.path),
    message: issue.message,
    currentValue: getReceivedValue(issue),
    suggestion: generateSuggestion(issue),
  };
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '(루트)';
  return path
    .map((p, i) => {
      if (typeof p === 'number') return `[${p}]`;
      return i === 0 ? p : `.${p}`;
    })
    .join('');
}

function getReceivedValue(issue: ZodIssue): unknown {
  if ('received' in issue) {
    const received = (issue as { received: unknown }).received;
    // 'undefined' string means missing field — display as (누락)
    if (received === 'undefined') return undefined;
    return received;
  }
  return undefined;
}

function generateSuggestion(issue: ZodIssue): string | undefined {
  if (issue.code === ZodIssueCode.invalid_enum_value) {
    const received = String(issue.received);
    const options = (issue.options as unknown[]).map(String);
    const closest = findClosest(received, options);
    if (closest) return `오타일 수 있습니다. "${closest}" 를 시도해보세요.`;
  }
  return undefined;
}

function findClosest(input: string, options: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const opt of options) {
    const dist = levenshtein(input.toLowerCase(), opt.toLowerCase());
    if (dist < bestDist && dist <= 2) {
      bestDist = dist;
      best = opt;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
