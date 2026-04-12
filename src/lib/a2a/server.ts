import type { AgentCard } from './types';

/** AutoDev의 A2A Agent Card 생성 */
export function getAutoDevAgentCard(baseUrl: string): AgentCard {
  return {
    name: 'AutoDev Agent',
    description: 'Universal AI development orchestrator. Submit coding tasks in natural language.',
    url: baseUrl,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: [
      {
        id: 'code-generation',
        name: 'Code Generation',
        description: 'Generate code from natural language descriptions',
        tags: ['coding', 'development', 'automation'],
        examples: ['Create a counter app with +, -, Reset buttons'],
      },
      {
        id: 'code-review',
        name: 'Code Review & Verification',
        description: 'Review and verify code changes with cross-LLM verification',
        tags: ['review', 'verification', 'testing'],
      },
      {
        id: 'refactoring',
        name: 'Code Refactoring',
        description: 'Refactor existing code for better quality',
        tags: ['refactor', 'improvement'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'file'],
  };
}
