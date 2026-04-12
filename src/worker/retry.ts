import { createHash } from 'crypto';

export interface RetryConfig {
  maxAttempts: number;
  timeBudgetMs: number;
  tokenBudget: number;
  sameErrorThreshold: number;
}

export interface AttemptRecord {
  attemptNum: number;
  errorMessage: string;
  errorHash: string;
  tokensUsed: number;
  durationMs: number;
  timestamp: number;
}

export type StopReason = 'max_attempts' | 'time_budget' | 'token_budget' | 'same_error_loop' | 'unfixable_error';
export type ErrorTier = 'transient' | 'fixable' | 'strategy_change' | 'unfixable';

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  timeBudgetMs: 300_000,
  tokenBudget: 100_000,
  sameErrorThreshold: 2,
};

export class RetryController {
  private config: RetryConfig;
  private _attempts: AttemptRecord[] = [];
  private startTime: number;
  private totalTokens = 0;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
  }

  get attempts(): AttemptRecord[] {
    return [...this._attempts];
  }

  recordAttempt(record: Omit<AttemptRecord, 'errorHash' | 'timestamp'>): void {
    this._attempts.push({
      ...record,
      errorHash: this.hashError(record.errorMessage),
      timestamp: Date.now(),
    });
    this.totalTokens += record.tokensUsed;
  }

  canRetry(): { allowed: boolean; reason?: StopReason } {
    if (this._attempts.length >= this.config.maxAttempts) {
      return { allowed: false, reason: 'max_attempts' };
    }
    if (Date.now() - this.startTime >= this.config.timeBudgetMs) {
      return { allowed: false, reason: 'time_budget' };
    }
    if (this.totalTokens >= this.config.tokenBudget * 0.8) {
      return { allowed: false, reason: 'token_budget' };
    }
    if (this._attempts.length >= this.config.sameErrorThreshold) {
      const recentHashes = this._attempts
        .slice(-this.config.sameErrorThreshold)
        .map(a => a.errorHash);
      if (recentHashes.every(h => h === recentHashes[0])) {
        return { allowed: false, reason: 'same_error_loop' };
      }
    }
    if (this._attempts.length > 0) {
      const lastError = this._attempts[this._attempts.length - 1].errorMessage;
      if (this.classifyError(lastError) === 'unfixable') {
        return { allowed: false, reason: 'unfixable_error' };
      }
    }
    return { allowed: true };
  }

  classifyError(errorMessage: string): ErrorTier {
    const lower = errorMessage.toLowerCase();
    if (lower.includes('permission denied') || lower.includes('eacces')) return 'unfixable';
    if (lower.includes('authentication') || lower.includes('401') || lower.includes('403')) return 'unfixable';
    if (lower.includes('not installed') || lower.includes('not found') || lower.includes('command not found')) return 'unfixable';
    if (lower.includes('out of memory') || lower.includes('oom')) return 'unfixable';
    if (lower.includes('disk full') || lower.includes('enospc')) return 'unfixable';
    if (lower.includes('credit balance') || lower.includes('insufficient_quota') || lower.includes('billing')) return 'strategy_change';
    if (lower.includes('429') || lower.includes('rate limit')) return 'transient';
    if (lower.includes('500') || lower.includes('502') || lower.includes('503')) return 'transient';
    if (lower.includes('timeout') || lower.includes('etimedout')) return 'transient';
    if (lower.includes('econnreset') || lower.includes('econnrefused')) return 'transient';
    if (lower.includes('syntax error') || lower.includes('syntaxerror')) return 'fixable';
    if (lower.includes('type error') || lower.includes('typeerror')) return 'fixable';
    if (lower.includes('import') || lower.includes('module not found') || lower.includes('cannot find module')) return 'fixable';
    if (lower.includes('lint') || lower.includes('eslint')) return 'fixable';
    if (lower.includes('test fail') || lower.includes('assertion')) return 'fixable';
    if (lower.includes('build fail') || lower.includes('compilation')) return 'fixable';
    if (lower.includes('verification failed')) return 'fixable';
    if (lower.includes('circular') || lower.includes('dependency cycle')) return 'strategy_change';
    if (errorMessage.length > 2000) return 'strategy_change';
    return 'fixable';
  }

  buildRetryContext(
    failedChecks: Array<{ description: string; actual?: string; expected?: string; type?: string; filePath?: string }>,
    passedChecks?: Array<{ description: string }>,
  ): string {
    const prevAttempts = this._attempts.map(a =>
      `Attempt ${a.attemptNum}: ${a.errorMessage.slice(0, 300)}`
    ).join('\n');

    // Build specific fix instructions
    const fixInstructions = failedChecks.map((c, i) => {
      let instruction = `${i + 1}. ${c.description}`;

      if (c.type === 'file_check' && c.expected && c.filePath) {
        instruction += `\n   → File "${c.filePath}" must contain the text: ${c.expected}`;
        instruction += `\n   → Add or modify the file so it includes exactly: ${c.expected}`;
      } else if (c.type === 'file_check' && c.actual?.includes('File not found')) {
        instruction += `\n   → The file does not exist. Create it.`;
      } else if (c.type === 'file_check' && c.actual?.includes('nearly empty')) {
        instruction += `\n   → The file exists but is nearly empty. Add the required content.`;
      } else if (c.type === 'build_check') {
        instruction += `\n   → The build command failed. Fix the build errors.`;
      } else if (c.type === 'dom_check') {
        instruction += `\n   → The expected element was not found in the rendered page.`;
      } else if (c.actual) {
        instruction += `\n   → ${c.actual}`;
      }

      return instruction;
    }).join('\n\n');

    const passedSection = (passedChecks && passedChecks.length > 0)
      ? `\n\n## ALREADY PASSING — do NOT break these:\n${passedChecks.map(c => `✓ ${c.description}`).join('\n')}`
      : '';

    return `Your previous attempt created files but verification FAILED.

## SPECIFIC FIXES NEEDED:
${fixInstructions}

## Previous attempt history:
${prevAttempts}
${passedSection}

## Rules:
- Fix ONLY the failing checks listed above
- Do NOT rewrite everything from scratch — modify the existing files
- The verification will check for the EXACT text patterns shown above
- If a check expects a specific string, your file must contain it exactly
- Make minimal changes to pass the failing checks
- Preserve everything that is already working`;
  }

  getAttemptCount(): number {
    return this._attempts.length;
  }

  getSummary(): {
    attempts: number;
    totalTokens: number;
    totalDurationMs: number;
    lastError: string | null;
    stopReason: StopReason | null;
  } {
    const { allowed, reason } = this.canRetry();
    return {
      attempts: this._attempts.length,
      totalTokens: this.totalTokens,
      totalDurationMs: Date.now() - this.startTime,
      lastError: this._attempts.length > 0 ? this._attempts[this._attempts.length - 1].errorMessage : null,
      stopReason: allowed ? null : (reason ?? null),
    };
  }

  private hashError(errorMessage: string): string {
    const normalized = errorMessage
      .replace(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[.\d]*/g, '<TIMESTAMP>')
      .replace(/:\d+:\d+/g, ':<LINE>')
      .replace(/0x[0-9a-fA-F]+/g, '<ADDR>')
      .replace(/\/[\w/.-]+\.(ts|js|tsx|jsx)/g, '<FILE>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }
}
