import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyIntent } from '../classifier';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (this: { messages: { create: typeof mockCreate } }) {
    this.messages = { create: mockCreate };
  }),
}));

function llmResponse(text: string, inputTokens = 100, outputTokens = 20) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe('classifyIntent (G19-2)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('LLM returns new → intent="new", fallbackUsed=false', async () => {
    mockCreate.mockResolvedValueOnce(
      llmResponse('{"intent":"new","confidence":0.92,"reason":"User describes a new workflow"}'),
    );
    const result = await classifyIntent({ userMessage: 'build me a daily report pipeline', projectId: 'p1' });
    expect(result.intent).toBe('new');
    expect(result.fallbackUsed).toBe(false);
    expect(result.confidence).toBe(0.92);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('LLM returns modify → intent="modify"', async () => {
    mockCreate.mockResolvedValueOnce(
      llmResponse('{"intent":"modify","confidence":0.85,"reason":"User asks to add a step"}'),
    );
    const result = await classifyIntent({
      userMessage: 'add a notification step',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.intent).toBe('modify');
    expect(result.fallbackUsed).toBe(false);
  });

  it('LLM returns clarify → intent="clarify"', async () => {
    mockCreate.mockResolvedValueOnce(
      llmResponse('{"intent":"clarify","confidence":0.7,"reason":"Request is too vague"}'),
    );
    const result = await classifyIntent({ userMessage: 'do something useful', projectId: 'p1' });
    expect(result.intent).toBe('clarify');
    expect(result.fallbackUsed).toBe(false);
  });

  it('SDK throws → heuristic fallback (modify when currentYaml exists)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limit exceeded'));
    const result = await classifyIntent({
      userMessage: 'add a step',
      projectId: 'p1',
      currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n',
    });
    expect(result.intent).toBe('modify');
    expect(result.fallbackUsed).toBe(true);
    expect(result.reason).toContain('SDK call failed');
    expect(result.costUsd).toBe(0);
  });

  it('JSON parse fails → heuristic fallback, fallbackUsed=true', async () => {
    mockCreate.mockResolvedValueOnce(llmResponse('this is not JSON at all'));
    const result = await classifyIntent({ userMessage: 'create something', projectId: 'p1' });
    expect(result.intent).toBe('new');
    expect(result.fallbackUsed).toBe(true);
    expect(result.reason).toContain('parse failed');
  });
});
