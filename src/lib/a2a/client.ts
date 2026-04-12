import type { AgentCard, A2ATask, A2AMessage } from './types';

/**
 * A2A Client — 외부 에이전트에 작업을 보내는 클라이언트.
 *
 * 사용 예시 (향후):
 *   const client = new A2AClient('https://external-agent.example.com');
 *   const card = await client.getAgentCard();
 *   const task = await client.sendTask({ ... });
 */
export class A2AClient {
  constructor(private agentUrl: string) {}

  /** 에이전트 카드 조회 — 에이전트의 능력/스킬 확인 */
  async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.agentUrl}/.well-known/agent.json`);
    if (!res.ok) throw new Error(`A2A: Failed to get agent card from ${this.agentUrl}`);
    return res.json();
  }

  /** 작업 전송 */
  async sendTask(params: {
    messages: A2AMessage[];
    sessionId?: string;
  }): Promise<A2ATask> {
    const res = await fetch(`${this.agentUrl}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/send',
        params: {
          id: crypto.randomUUID(),
          sessionId: params.sessionId ?? crypto.randomUUID(),
          message: params.messages[params.messages.length - 1],
        },
      }),
    });
    if (!res.ok) throw new Error(`A2A: Task send failed`);
    const data = await res.json();
    return data.result;
  }

  /** 작업 상태 조회 */
  async getTask(taskId: string): Promise<A2ATask> {
    const res = await fetch(`${this.agentUrl}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { id: taskId },
      }),
    });
    if (!res.ok) throw new Error(`A2A: Task get failed`);
    const data = await res.json();
    return data.result;
  }
}
