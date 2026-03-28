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

  buildRetryContext(failedChecks: Array<{ description: string; actual?: string }>): string {
    const prevAttempts = this._attempts.map(a =>
      `Attempt ${a.attemptNum}: ${a.errorMessage.slice(0, 300)}`
    ).join('\n');

    const failedList = failedChecks.map(c =>
      `- ${c.description}${c.actual ? `: ${c.actual}` : ''}`
    ).join('\n');

    return `Previous attempts failed. Here is the context for your retry:

## Failed verification checks:
${failedList}

## Previous attempt history:
${prevAttempts}

## Instructions:
- Fix the issues identified in the failed checks above
- Do NOT repeat the same approach that failed before
- Focus specifically on the verification failures
- If a previous attempt caused a regression, revert that change first`;
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
