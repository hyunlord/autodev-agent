import type { IAgent, AgentRole } from './interfaces';
import { PlanningAgent } from './planning/planning-agent';
import { CodingAgentWrapper } from './coding/coding-agent';
import { VerifyAgent } from './verify/verify-agent';
import { InterviewAgent } from './interview/interview-agent';
import { PluginRegistry } from '../lib/plugins/registry';

export class AgentRegistry {
  private static agents: Map<string, IAgent> = new Map();

  /** Get or create a planning agent */
  static getPlanningAgent(mode?: string): PlanningAgent {
    const id = `planning-${mode ?? 'claude-cli'}`;
    if (!this.agents.has(id)) {
      this.agents.set(id, new PlanningAgent(mode));
    }
    return this.agents.get(id) as PlanningAgent;
  }

  /** Get or create a coding agent (wraps existing ICodingAgent) */
  static async getCodingAgent(agentId?: string): Promise<CodingAgentWrapper | null> {
    const registry = PluginRegistry.instance;
    const agents = registry.listAgents();

    if (agentId && agentId !== 'auto') {
      const inner = agents.find(a => a.id === agentId);
      if (inner && await inner.isAvailable()) {
        return new CodingAgentWrapper(inner);
      }
    }

    // Auto-select first available
    for (const inner of agents) {
      if (await inner.isAvailable()) {
        return new CodingAgentWrapper(inner);
      }
    }

    return null;
  }

  /** Get or create a verify agent (different from coding agent) */
  static async getVerifyAgent(codingAgentId: string): Promise<VerifyAgent> {
    return VerifyAgent.selectDifferentFrom(codingAgentId);
  }

  /** Get or create an interview agent */
  static getInterviewAgent(llm?: string): InterviewAgent {
    return new InterviewAgent(llm);
  }

  /** List all available agents by role */
  static async listByRole(role: AgentRole): Promise<IAgent[]> {
    const results: IAgent[] = [];

    if (role === 'planning') {
      for (const mode of ['claude-cli', 'gemini-cli', 'codex-cli', 'api']) {
        const agent = new PlanningAgent(mode);
        if (await agent.isAvailable()) results.push(agent);
      }
    }

    if (role === 'coding') {
      const registry = PluginRegistry.instance;
      for (const inner of registry.listAgents()) {
        if (await inner.isAvailable()) {
          results.push(new CodingAgentWrapper(inner));
        }
      }
    }

    if (role === 'verify') {
      for (const llm of ['gemini-cli', 'claude-cli', 'claude-api']) {
        const agent = new VerifyAgent(llm);
        if (await agent.isAvailable()) results.push(agent);
      }
    }

    if (role === 'interview') {
      results.push(new InterviewAgent());
    }

    return results;
  }
}
