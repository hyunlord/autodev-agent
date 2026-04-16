export type AgentHealthStatus =
  | 'available'
  | 'rate_limited'
  | 'credit_exhausted'
  | 'unavailable'
  | 'unknown';

export interface AgentHealth {
  agentId: string;
  status: AgentHealthStatus;
  reason?: string;
  recentFailures: {
    count: number;
    lastError?: string;
    lastErrorAt?: string;
  };
  avgResponseTimeMs: number;
  successRate: number;       // 0-1
  lastCheckedAt: string;
}

// agentId → CLI short name for resolveCli
const CLI_NAME_MAP: Record<string, string> = {
  'claude-code': 'claude',
  'claude-cli': 'claude',
  'gemini-cli': 'gemini',
  'codex-cli': 'codex',
  'aider': 'aider',
  'cline-cli': 'cline',
};

export class HealthMonitor {
  private static healthCache = new Map<string, { health: AgentHealth; expiresAt: number }>();
  private static CACHE_TTL_MS = 60_000; // 1분

  /** 에이전트 상태 체크 (캐시 우선) */
  static async checkAgent(agentId: string): Promise<AgentHealth> {
    const cached = this.healthCache.get(agentId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.health;
    }

    const health = await this.probeAgent(agentId);
    this.healthCache.set(agentId, {
      health,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
    return health;
  }

  /** 실제 프로빙 (캐시 무시) */
  static async probeAgent(agentId: string): Promise<AgentHealth> {
    // 1. CLI 존재 여부
    const { resolveCli } = await import('@/lib/cli-resolver');
    const cliName = CLI_NAME_MAP[agentId] ?? agentId;
    const cliPath = await resolveCli(cliName);
    if (!cliPath) {
      return this.buildHealth(agentId, 'unavailable', 'CLI not installed');
    }

    // 2. 에이전트별 상태 체크
    switch (agentId) {
      case 'claude-code':
      case 'claude-cli':
        return this.probeClaude(cliPath, agentId);
      case 'gemini-cli':
        return this.probeGemini(agentId);
      case 'codex-cli':
        return this.probeCodex(agentId);
      default:
        return this.buildHealth(agentId, 'unknown', 'No prober');
    }
  }

  /** Claude: CLI 확인 + 최근 에러 패턴 체크 */
  private static async probeClaude(cliPath: string, agentId: string): Promise<AgentHealth> {
    const { getExeca } = await import('@/lib/execa');
    const execa = await getExeca();

    try {
      const { exitCode } = await execa(cliPath, ['--help'], {
        timeout: 10_000,
        reject: false,
      });

      if (exitCode !== 0) {
        return this.buildHealth(agentId, 'unavailable', 'CLI error');
      }

      const recent = await this.getRecentErrors(agentId, 10);
      const hasCredit = recent.some(r =>
        /credit|billing|insufficient_quota/i.test(r.errorLog ?? '')
      );
      if (hasCredit) {
        return this.buildHealth(agentId, 'credit_exhausted', 'Recent credit error');
      }

      const hasRateLimit = recent.some(r =>
        /rate.?limit|too many requests/i.test(r.errorLog ?? '')
      );
      if (hasRateLimit) {
        return this.buildHealth(agentId, 'rate_limited', 'Recent rate limit');
      }

      return this.buildHealth(agentId, 'available');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.buildHealth(agentId, 'unavailable', msg);
    }
  }

  /** Gemini: 최근 실패 패턴으로 감지 */
  private static async probeGemini(agentId: string): Promise<AgentHealth> {
    const recent = await this.getRecentErrors(agentId, 10);
    const hasRateLimit = recent.some(r =>
      /rate.?limit|quota|resource.?exhausted/i.test(r.errorLog ?? '')
    );
    if (hasRateLimit) {
      return this.buildHealth(agentId, 'rate_limited', 'Recent rate limit');
    }
    return this.buildHealth(agentId, 'available');
  }

  /** Codex: 최근 실패 패턴으로 감지 */
  private static async probeCodex(agentId: string): Promise<AgentHealth> {
    const recent = await this.getRecentErrors(agentId, 10);
    const hasRateLimit = recent.some(r =>
      /rate.?limit|quota/i.test(r.errorLog ?? '')
    );
    if (hasRateLimit) {
      return this.buildHealth(agentId, 'rate_limited', 'Recent rate limit');
    }
    return this.buildHealth(agentId, 'available');
  }

  /** DB에서 최근 에러 조회 */
  private static async getRecentErrors(agentId: string, minutes: number) {
    const { db } = await import('@/lib/db/client');
    const { attempts } = await import('@/lib/db/schema');
    const { eq, and, gte, desc } = await import('drizzle-orm');

    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    return db.select({
      errorLog: attempts.errorLog,
      createdAt: attempts.createdAt,
    })
      .from(attempts)
      .where(and(
        eq(attempts.agentId, agentId),
        eq(attempts.status, 'error'),
        gte(attempts.createdAt, cutoff)
      ))
      .orderBy(desc(attempts.createdAt))
      .limit(20)
      .all();
  }

  /** 최근 10회 통계 */
  private static async getStats(agentId: string): Promise<{
    avgResponseTimeMs: number;
    successRate: number;
    recentFailures: { count: number; lastError?: string; lastErrorAt?: string };
  }> {
    const { db } = await import('@/lib/db/client');
    const { attempts } = await import('@/lib/db/schema');
    const { eq, desc } = await import('drizzle-orm');

    const recent = db.select()
      .from(attempts)
      .where(eq(attempts.agentId, agentId))
      .orderBy(desc(attempts.createdAt))
      .limit(10)
      .all();

    if (recent.length === 0) {
      return { avgResponseTimeMs: 0, successRate: 1, recentFailures: { count: 0 } };
    }

    const successes = recent.filter(r => r.status === 'success').length;
    const failures = recent.filter(r => r.status === 'error');
    const withDuration = recent.filter(r => r.durationMs != null);
    const avgMs = withDuration.length > 0
      ? withDuration.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / withDuration.length
      : 0;

    return {
      avgResponseTimeMs: Math.round(avgMs),
      successRate: successes / recent.length,
      recentFailures: {
        count: failures.length,
        lastError: failures[0]?.errorLog ?? undefined,
        lastErrorAt: failures[0]?.createdAt ?? undefined,
      },
    };
  }

  private static async buildHealth(
    agentId: string,
    status: AgentHealthStatus,
    reason?: string
  ): Promise<AgentHealth> {
    const stats = await this.getStats(agentId);
    return {
      agentId,
      status,
      reason,
      recentFailures: stats.recentFailures,
      avgResponseTimeMs: stats.avgResponseTimeMs,
      successRate: stats.successRate,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  /** 모든 주요 에이전트 상태 */
  static async checkAll(): Promise<AgentHealth[]> {
    const agentIds = ['claude-code', 'gemini-cli', 'codex-cli'];
    return Promise.all(agentIds.map(id => this.checkAgent(id)));
  }

  /** 캐시 무효화 (실패 직후 호출) */
  static invalidate(agentId: string) {
    this.healthCache.delete(agentId);
  }
}
