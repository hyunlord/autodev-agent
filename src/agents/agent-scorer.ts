import { HealthMonitor, type AgentHealth } from './health-monitor';
import { extractTags } from './tags-extractor';

export interface ScoreContext {
  taskPrompt: string;
  projectType?: string;
  costPreference?: 'cheap' | 'balanced' | 'quality';
  estimatedComplexity?: 'simple' | 'medium' | 'complex';
  projectDir?: string;
}

export interface AgentScore {
  agentId: string;
  score: number;              // 0-100
  breakdown: {
    health: number;           // 0-40
    historical: number;       // 0-30
    costMatch: number;        // 0-20
    complexityMatch: number;  // 0-10
  };
  reasoning: string[];
  health: AgentHealth;
}

export class AgentScorer {
  /** 모든 가용 에이전트를 점수화하고 정렬된 리스트 반환 */
  static async scoreAll(context: ScoreContext): Promise<AgentScore[]> {
    const healths = await HealthMonitor.checkAll();
    const tags = extractTags(context.taskPrompt);

    const scores = await Promise.all(
      healths.map(health => this.scoreAgent(health, context, tags))
    );

    return scores
      .filter(s => s.health.status !== 'unavailable')
      .sort((a, b) => b.score - a.score);
  }

  /** 단일 에이전트 점수 */
  private static async scoreAgent(
    health: AgentHealth,
    context: ScoreContext,
    tags: string[]
  ): Promise<AgentScore> {
    const reasoning: string[] = [];

    // 1. Health (0-40)
    let healthScore = 0;
    switch (health.status) {
      case 'available':
        healthScore = 40;
        reasoning.push('Available and healthy');
        break;
      case 'rate_limited':
        healthScore = 5;
        reasoning.push('Rate limited — may recover soon');
        break;
      case 'credit_exhausted':
        healthScore = 0;
        reasoning.push('No credits remaining');
        break;
      case 'unavailable':
        healthScore = 0;
        reasoning.push('Unavailable');
        break;
      default:
        healthScore = 20;
    }
    // 성공률 보너스/페널티
    healthScore = Math.round(healthScore * (0.5 + health.successRate * 0.5));

    // 2. 히스토리 매칭 (0-30)
    const historicalScore = await this.computeHistoricalScore(health.agentId, tags);
    if (historicalScore > 20) {
      reasoning.push(`Strong history on [${tags.join(', ')}] tasks`);
    }

    // 3. 비용 매칭 (0-20)
    const costScore = this.computeCostScore(health.agentId, context.costPreference);

    // 4. 복잡도 매칭 (0-10)
    const complexityScore = this.computeComplexityScore(
      health.agentId,
      context.estimatedComplexity ?? 'medium'
    );

    const total = healthScore + historicalScore + costScore + complexityScore;

    return {
      agentId: health.agentId,
      score: total,
      breakdown: {
        health: healthScore,
        historical: historicalScore,
        costMatch: costScore,
        complexityMatch: complexityScore,
      },
      reasoning,
      health,
    };
  }

  /** 태그 기반 과거 성공률 (0-30) */
  private static async computeHistoricalScore(
    agentId: string,
    tags: string[]
  ): Promise<number> {
    if (tags.length === 0) return 15; // 중립

    const { db } = await import('@/lib/db/client');
    const { tasks, attempts } = await import('@/lib/db/schema');
    const { eq, and, sql } = await import('drizzle-orm');

    // 최근 유사 태그 포함 작업의 성공률
    const results = db.select({
      status: tasks.status,
    })
      .from(tasks)
      .innerJoin(attempts, eq(attempts.taskId, tasks.id))
      .where(and(
        eq(attempts.agentId, agentId),
        sql`${tasks.prompt} LIKE ${'%' + tags[0] + '%'}`
      ))
      .limit(20)
      .all();

    if (results.length < 3) return 15; // 데이터 부족 → 중립

    const success = results.filter(r => r.status === 'completed').length;
    const rate = success / results.length;
    return Math.round(rate * 30);
  }

  /** 비용 매칭 (0-20) */
  private static computeCostScore(
    agentId: string,
    preference: 'cheap' | 'balanced' | 'quality' = 'balanced'
  ): number {
    const costTier: Record<string, 'cheap' | 'medium' | 'expensive'> = {
      'gemini-cli': 'cheap',
      'codex-cli': 'medium',
      'claude-code': 'expensive',
      'claude-cli': 'expensive',
      'aider': 'cheap',
      'cline-cli': 'medium',
    };

    const tier = costTier[agentId] ?? 'medium';

    const matrix: Record<string, Record<string, number>> = {
      cheap: { cheap: 20, medium: 10, expensive: 0 },
      balanced: { cheap: 15, medium: 20, expensive: 15 },
      quality: { cheap: 5, medium: 15, expensive: 20 },
    };

    return matrix[preference][tier];
  }

  /** 복잡도 매칭 (0-10) */
  private static computeComplexityScore(
    agentId: string,
    complexity: 'simple' | 'medium' | 'complex'
  ): number {
    const capability: Record<string, Record<string, number>> = {
      'gemini-cli': { simple: 10, medium: 6, complex: 3 },
      'codex-cli': { simple: 7, medium: 10, complex: 8 },
      'claude-code': { simple: 8, medium: 10, complex: 10 },
      'claude-cli': { simple: 8, medium: 10, complex: 10 },
      'aider': { simple: 8, medium: 7, complex: 4 },
      'cline-cli': { simple: 7, medium: 8, complex: 6 },
    };

    return capability[agentId]?.[complexity] ?? 5;
  }
}
