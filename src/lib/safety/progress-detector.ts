import { createHash } from 'crypto';

export interface CycleRecord {
  cycle: number;
  success: boolean;
  summary: string;
  modifiedFiles: string[];
  costUsd: number;
  errorMessage?: string;
}

export interface ProgressCheckResult {
  shouldContinue: boolean;
  reason?: string;
  recommendation?: 'continue' | 'warn' | 'stop';
}

export class ProgressDetector {
  private history: CycleRecord[] = [];
  private maxCostUsd: number;
  private maxConsecutiveFailures: number;

  constructor(opts?: {
    maxCostUsd?: number;
    maxConsecutiveFailures?: number;
  }) {
    this.maxCostUsd = opts?.maxCostUsd ?? 5.0;
    this.maxConsecutiveFailures = opts?.maxConsecutiveFailures ?? 3;
  }

  /**
   * Record a completed cycle
   */
  record(cycle: CycleRecord): void {
    this.history.push(cycle);
  }

  /**
   * Check if the auto-cycle should continue
   */
  check(): ProgressCheckResult {
    if (this.history.length === 0) {
      return { shouldContinue: true, recommendation: 'continue' };
    }

    // 1. Same error repeated — hash-based detection
    const sameErrorResult = this.checkSameError();
    if (!sameErrorResult.shouldContinue) return sameErrorResult;

    // 2. Consecutive failures with no progress
    const noProgressResult = this.checkNoProgress();
    if (!noProgressResult.shouldContinue) return noProgressResult;

    // 3. Cost cap
    const costResult = this.checkCostCap();
    if (!costResult.shouldContinue) return costResult;

    // 4. Diminishing returns
    const diminishingResult = this.checkDiminishingReturns();
    if (!diminishingResult.shouldContinue) return diminishingResult;

    return { shouldContinue: true, recommendation: 'continue' };
  }

  /**
   * Get total cost across all cycles
   */
  getTotalCost(): number {
    return this.history.reduce((sum, c) => sum + c.costUsd, 0);
  }

  /**
   * Get summary stats
   */
  getStats(): { total: number; passed: number; failed: number; totalCost: number } {
    return {
      total: this.history.length,
      passed: this.history.filter(c => c.success).length,
      failed: this.history.filter(c => !c.success).length,
      totalCost: this.getTotalCost(),
    };
  }

  // ─── Private checks ───────────────────────────────

  private checkSameError(): ProgressCheckResult {
    const recent = this.history.slice(-2);
    if (recent.length < 2) return { shouldContinue: true };

    if (!recent[0].success && !recent[1].success) {
      const hash0 = this.errorHash(recent[0].errorMessage ?? recent[0].summary);
      const hash1 = this.errorHash(recent[1].errorMessage ?? recent[1].summary);

      if (hash0 === hash1) {
        return {
          shouldContinue: false,
          reason: `Same error repeated 2 times: ${recent[1].summary.slice(0, 100)}`,
          recommendation: 'stop',
        };
      }
    }

    return { shouldContinue: true };
  }

  private checkNoProgress(): ProgressCheckResult {
    const recent = this.history.slice(-this.maxConsecutiveFailures);
    if (recent.length < this.maxConsecutiveFailures) return { shouldContinue: true };

    const allFailed = recent.every(c => !c.success);
    const noFiles = recent.every(c => c.modifiedFiles.length === 0);

    if (allFailed && noFiles) {
      return {
        shouldContinue: false,
        reason: `${this.maxConsecutiveFailures} consecutive failures with no file modifications`,
        recommendation: 'stop',
      };
    }

    if (allFailed) {
      return {
        shouldContinue: false,
        reason: `${this.maxConsecutiveFailures} consecutive failures`,
        recommendation: 'stop',
      };
    }

    return { shouldContinue: true };
  }

  private checkCostCap(): ProgressCheckResult {
    const totalCost = this.getTotalCost();

    if (totalCost >= this.maxCostUsd) {
      return {
        shouldContinue: false,
        reason: `Cost cap reached: $${totalCost.toFixed(4)} >= $${this.maxCostUsd.toFixed(2)}`,
        recommendation: 'stop',
      };
    }

    // Warn at 80%
    if (totalCost >= this.maxCostUsd * 0.8) {
      return {
        shouldContinue: true,
        reason: `Cost warning: $${totalCost.toFixed(4)} (80% of $${this.maxCostUsd.toFixed(2)} cap)`,
        recommendation: 'warn',
      };
    }

    return { shouldContinue: true };
  }

  private checkDiminishingReturns(): ProgressCheckResult {
    if (this.history.length < 5) return { shouldContinue: true };

    // Compare last 3 cycles vs previous 3 cycles
    const recent = this.history.slice(-3);
    const earlier = this.history.slice(-6, -3);

    if (earlier.length < 3) return { shouldContinue: true };

    const recentSuccessRate = recent.filter(c => c.success).length / recent.length;
    const earlierSuccessRate = earlier.filter(c => c.success).length / earlier.length;

    // If success rate dropped significantly and recent is mostly failing
    if (recentSuccessRate < 0.34 && earlierSuccessRate > recentSuccessRate) {
      return {
        shouldContinue: false,
        reason: `Diminishing returns: success rate dropped from ${(earlierSuccessRate * 100).toFixed(0)}% to ${(recentSuccessRate * 100).toFixed(0)}%`,
        recommendation: 'stop',
      };
    }

    return { shouldContinue: true };
  }

  private errorHash(message: string): string {
    // Normalize error message: remove line numbers, timestamps, paths
    const normalized = message
      .replace(/line \d+/gi, 'line N')
      .replace(/:\d+:\d+/g, ':N:N')
      .replace(/\/[\w/.-]+\//g, '/')
      .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
      .trim()
      .slice(0, 200);

    return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  }
}
