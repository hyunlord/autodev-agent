import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIBuilderOrchestrator } from '../orchestrator';

const { mockClassify, mockAssemble } = vi.hoisted(() => ({
  mockClassify: vi.fn(),
  mockAssemble: vi.fn(),
}));

vi.mock('../intent/classifier', () => ({
  classifyIntent: mockClassify,
}));

vi.mock('../context/assembler', () => ({
  assembleSystemPrompt: mockAssemble,
}));

function classified(intent: 'new' | 'modify' | 'clarify' | 'explain', fallbackUsed = false) {
  return {
    intent,
    confidence: fallbackUsed ? 0.5 : 0.9,
    reason: fallbackUsed ? 'fallback: SDK call failed (mocked)' : 'ok',
    costUsd: fallbackUsed ? 0 : 0.001,
    inputTokens: fallbackUsed ? 0 : 100,
    outputTokens: fallbackUsed ? 0 : 20,
    fallbackUsed,
  };
}

function assembled(estimatedSystemTokens = 5000) {
  return {
    systemPrompt: 'mocked system prompt',
    userMessage: 'mocked user message',
    conversationHistory: [],
    fragmentsUsed: [] as string[],
    estimatedSystemTokens,
  };
}

beforeEach(() => {
  mockClassify.mockReset();
  mockAssemble.mockReset();
  mockAssemble.mockReturnValue(assembled());
});

describe('AIBuilderOrchestrator (G19-3c)', () => {
  it('intent="new" when classifier returns new', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'create a new pipeline',
      projectId: 'p1',
    });
    expect(result.intent).toBe('new');
    expect(result.steps).toContain('classify_intent');
    expect(result.steps).toContain('assemble_context');
  });

  it('intent="modify" when classifier returns modify', async () => {
    mockClassify.mockResolvedValueOnce(classified('modify'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'add a step',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.intent).toBe('modify');
  });

  it('skeleton warns that LLM is not wired and reports zero attempts', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('not implemented'))).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.steps).not.toContain('call_llm');
  });

  it('classifier fallbackUsed=true → warnings include classification fallback', async () => {
    mockClassify.mockResolvedValueOnce(classified('modify', true));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'change something',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.warnings).toContain('intent classification fallback used');
    expect(result.warnings.some((w) => w.includes('not implemented'))).toBe(true);
  });

  it('assembler throw → graceful fallback with assemble_context warning', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockAssemble.mockImplementationOnce(() => {
      throw new Error('disk read failed');
    });
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('assemble_context failed'))).toBe(true);
    expect(result.steps).toEqual(['classify_intent']);
  });

  it('estimatedSystemTokens > soft budget → warnings include budget notice', async () => {
    mockClassify.mockResolvedValueOnce(classified('new'));
    mockAssemble.mockReturnValueOnce(assembled(15000));
    const result = await new AIBuilderOrchestrator().run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('soft budget'))).toBe(true);
  });
});
