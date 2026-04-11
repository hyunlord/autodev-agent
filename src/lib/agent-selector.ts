import { PluginRegistry } from './plugins/registry';
import type { ICodingAgent } from './plugins/interfaces';

// Fallback order if recommended agent is not available
const DEFAULT_AGENT_ORDER = ['claude-code', 'gemini-cli', 'codex-cli', 'aider', 'cline-cli'];

// 에이전트별 상대 비용 (1=저렴, 3=비쌈)
const AGENT_COST_TIER: Record<string, number> = {
  'claude-code': 3,
  'codex-cli': 2,
  'gemini-cli': 1,
  'aider': 1,
  'cline-cli': 2,
};

export type CostPreference = 'cheap' | 'balanced' | 'quality';

export async function selectAgent(
  recommendedAgentId?: string | null,
  userOverrideId?: string | null,
  costPreference?: CostPreference,
): Promise<{ agent: ICodingAgent; agentId: string; autoSelected: boolean }> {
  // 1. User manually selected an agent (not 'auto') — always respect
  if (userOverrideId && userOverrideId !== 'auto') {
    const preferred = PluginRegistry.instance.getAgent(userOverrideId);
    if (preferred && await preferred.isAvailable()) {
      return { agent: preferred, agentId: preferred.id, autoSelected: false };
    }
  }

  // 2. LLM recommended an agent — try it (balanced 모드에서만)
  if (recommendedAgentId && (!costPreference || costPreference === 'balanced')) {
    const recommended = PluginRegistry.instance.getAgent(recommendedAgentId);
    if (recommended && await recommended.isAvailable()) {
      return { agent: recommended, agentId: recommended.id, autoSelected: true };
    }
  }

  // 3. Cost preference 기반 자동 선택
  if (costPreference && costPreference !== 'balanced') {
    const available: ICodingAgent[] = [];
    for (const id of DEFAULT_AGENT_ORDER) {
      const agent = PluginRegistry.instance.getAgent(id);
      if (agent && await agent.isAvailable()) {
        available.push(agent);
      }
    }

    if (available.length > 0) {
      if (costPreference === 'cheap') {
        available.sort((a, b) => (AGENT_COST_TIER[a.id] ?? 2) - (AGENT_COST_TIER[b.id] ?? 2));
      } else if (costPreference === 'quality') {
        available.sort((a, b) => (AGENT_COST_TIER[b.id] ?? 2) - (AGENT_COST_TIER[a.id] ?? 2));
      }
      return { agent: available[0], agentId: available[0].id, autoSelected: true };
    }
  }

  // 4. Fallback: first available in default order
  for (const agentId of DEFAULT_AGENT_ORDER) {
    const agent = PluginRegistry.instance.getAgent(agentId);
    if (agent && await agent.isAvailable()) {
      return { agent, agentId: agent.id, autoSelected: true };
    }
  }

  // 5. Absolute fallback: any available
  const all = PluginRegistry.instance.listAgents();
  for (const agent of all) {
    if (await agent.isAvailable()) {
      return { agent, agentId: agent.id, autoSelected: true };
    }
  }

  throw new Error('No coding agents available');
}

/**
 * J6: 연속 실패 시 대체 에이전트 선택.
 * failedAgentId와 excludeIds를 제외한 사용 가능한 에이전트 중 costPreference에 맞는 것을 반환.
 */
export async function selectAlternativeAgent(
  failedAgentId: string,
  excludeIds?: string[],
  costPreference?: CostPreference,
): Promise<{ agent: ICodingAgent; agentId: string } | null> {
  const excluded = new Set([failedAgentId, ...(excludeIds ?? [])]);
  const candidates: ICodingAgent[] = [];

  for (const id of DEFAULT_AGENT_ORDER) {
    if (excluded.has(id)) continue;
    const agent = PluginRegistry.instance.getAgent(id);
    if (agent && await agent.isAvailable()) {
      candidates.push(agent);
    }
  }

  if (candidates.length === 0) return null;

  if (costPreference === 'cheap') {
    candidates.sort((a, b) => (AGENT_COST_TIER[a.id] ?? 2) - (AGENT_COST_TIER[b.id] ?? 2));
  } else if (costPreference === 'quality') {
    candidates.sort((a, b) => (AGENT_COST_TIER[b.id] ?? 2) - (AGENT_COST_TIER[a.id] ?? 2));
  }

  return { agent: candidates[0], agentId: candidates[0].id };
}
