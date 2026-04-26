import { describe, it, expect, beforeEach } from 'vitest';
import { assembleSystemPrompt } from '../assembler';
import { __resetFragmentCache } from '../fragment-loader';
import type { AIBuilderRequest, IntentClassification } from '../../types';

function classification(intent: IntentClassification['intent']): IntentClassification {
  return {
    intent,
    confidence: 0.9,
    reason: 'test',
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    fallbackUsed: false,
  };
}

beforeEach(() => {
  __resetFragmentCache();
});

describe('assembleSystemPrompt', () => {
  it('produces all 5 sections in order (IDENTITY / TASK / ADPL SPEC / OUTPUT FORMAT / EXAMPLES)', () => {
    const req: AIBuilderRequest = { userMessage: 'create a daily build', projectId: 'p1' };
    const out = assembleSystemPrompt(req, classification('new'));
    const sp = out.systemPrompt;

    const idxIdentity = sp.indexOf('## IDENTITY');
    const idxTask = sp.indexOf('## TASK');
    const idxSpec = sp.indexOf('## ADPL SPEC');
    const idxOutput = sp.indexOf('## OUTPUT FORMAT');
    const idxExamples = sp.indexOf('## EXAMPLES');

    expect(idxIdentity).toBeGreaterThanOrEqual(0);
    expect(idxTask).toBeGreaterThan(idxIdentity);
    expect(idxSpec).toBeGreaterThan(idxTask);
    expect(idxOutput).toBeGreaterThan(idxSpec);
    expect(idxExamples).toBeGreaterThan(idxOutput);
  });

  it('intent="new" with a parallel cue activates the parallel fragment', () => {
    const req: AIBuilderRequest = {
      userMessage: 'lint, test 를 병렬로 돌리고 싶어',
      projectId: 'p1',
    };
    const out = assembleSystemPrompt(req, classification('new'));
    expect(out.fragmentsUsed).toContain('parallel');
    expect(out.systemPrompt).toContain('Active Task Fragments');
  });

  it('intent="clarify" picks the clarify few-shot first', () => {
    const req: AIBuilderRequest = { userMessage: '뭔가 알려줘', projectId: 'p1' };
    const out = assembleSystemPrompt(req, classification('clarify'));
    expect(out.systemPrompt).toContain('"intent_recognized": "clarify"');
    expect(out.systemPrompt).toContain('clarification_questions');
  });

  it('reports a positive token estimate', () => {
    const req: AIBuilderRequest = { userMessage: 'anything', projectId: 'p1' };
    const out = assembleSystemPrompt(req, classification('new'));
    expect(out.estimatedSystemTokens).toBeGreaterThan(0);
  });

  it('messages with no fragment cues yield empty fragmentsUsed', () => {
    const req: AIBuilderRequest = { userMessage: 'unrelated text', projectId: 'p1' };
    const out = assembleSystemPrompt(req, classification('new'));
    expect(out.fragmentsUsed).toEqual([]);
    expect(out.systemPrompt).not.toContain('Active Task Fragments');
  });

  it('preserves conversationHistory for the LLM messages array', () => {
    const req: AIBuilderRequest = {
      userMessage: 'follow up',
      projectId: 'p1',
      conversationHistory: [
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'reply' },
      ],
    };
    const out = assembleSystemPrompt(req, classification('new'));
    expect(out.conversationHistory).toHaveLength(2);
    expect(out.conversationHistory[0].content).toBe('first turn');
  });
});
