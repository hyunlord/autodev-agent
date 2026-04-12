/**
 * Google A2A (Agent-to-Agent) Protocol Types
 * Spec: https://google.github.io/A2A/
 *
 * AutoDev는 A2A 서버(외부 에이전트 작업 수신) +
 * A2A 클라이언트(외부 에이전트에 작업 전송) 둘 다 가능.
 */

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface A2ATask {
  id: string;
  sessionId: string;
  status: A2ATaskStatus;
  messages: A2AMessage[];
  artifacts: A2AArtifact[];
  history: A2AStatusEvent[];
}

export interface A2ATaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  message?: string;
  timestamp: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { name: string; mimeType: string; bytes: string } }
  | { type: 'data'; data: Record<string, unknown> };

export interface A2AArtifact {
  id: string;
  name: string;
  parts: A2APart[];
}

export interface A2AStatusEvent {
  state: A2ATaskStatus['state'];
  timestamp: string;
  message?: string;
}
