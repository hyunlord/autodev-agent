import { PluginRegistry } from './plugins/registry';
import type { ICodingAgent } from './plugins/interfaces';

// Fallback order if recommended agent is not available
const DEFAULT_AGENT_ORDER = ['claude-code', 'gemini-cli', 'codex-cli', 'aider', 'cline-cli'];

export async function selectAgent(
  recommendedAgentId?: string | null,
  userOverrideId?: string | null,
): Promise<{ agent: ICodingAgent; agentId: string; autoSelected: boolean }> {
  // 1. User manually selected an agent (not 'auto') — always respect
  if (userOverrideId && userOverrideId !== 'auto') {
    const preferred = PluginRegistry.instance.getAgent(userOverrideId);
    if (preferred && await preferred.isAvailable()) {
      return { agent: preferred, agentId: preferred.id, autoSelected: false };
    }
  }

  // 2. LLM recommended an agent — try it
  if (recommendedAgentId) {
    const recommended = PluginRegistry.instance.getAgent(recommendedAgentId);
    if (recommended && await recommended.isAvailable()) {
      return { agent: recommended, agentId: recommended.id, autoSelected: true };
    }
  }

  // 3. Fallback: first available in default order
  for (const agentId of DEFAULT_AGENT_ORDER) {
    const agent = PluginRegistry.instance.getAgent(agentId);
    if (agent && await agent.isAvailable()) {
      return { agent, agentId: agent.id, autoSelected: true };
    }
  }

  // 4. Absolute fallback: any available
  const all = PluginRegistry.instance.listAgents();
  for (const agent of all) {
    if (await agent.isAvailable()) {
      return { agent, agentId: agent.id, autoSelected: true };
    }
  }

  throw new Error('No coding agents available');
}
