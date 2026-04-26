import { describe, it, expect } from 'vitest';
import { buildTaskSection } from '../task-builder';
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

const baseReq: AIBuilderRequest = { userMessage: 'do something', projectId: 'p1' };

describe('buildTaskSection', () => {
  it('new intent omits Current YAML block', () => {
    const out = buildTaskSection(baseReq, classification('new'));
    expect(out).toContain('Generate a new ADPL pipeline');
    expect(out).not.toContain('Current YAML:');
  });

  it('modify intent includes Current YAML block', () => {
    const out = buildTaskSection(
      { ...baseReq, currentYaml: 'adplVersion: 1\nname: x\npipeline: []\n' },
      classification('modify'),
    );
    expect(out).toContain('Modify the existing ADPL pipeline');
    expect(out).toContain('Current YAML:');
    expect(out).toContain('adplVersion: 1');
    expect(out).toContain('Populate the diff');
  });

  it('clarify intent asks for clarifying questions and no yaml', () => {
    const out = buildTaskSection(baseReq, classification('clarify'));
    expect(out).toContain('clarifying questions');
    expect(out).toContain('generated_yaml as null');
  });

  it('explain intent forbids modification', () => {
    const out = buildTaskSection(
      { ...baseReq, currentYaml: 'adplVersion: 1\nname: y\npipeline: []\n' },
      classification('explain'),
    );
    expect(out).toContain('Do NOT modify');
    expect(out).toContain('Current YAML:');
  });

  it('user message trims and appears in output', () => {
    const out = buildTaskSection({ ...baseReq, userMessage: '  add a step  ' }, classification('new'));
    expect(out).toContain('add a step');
    expect(out).not.toContain('  add a step  ');
  });
});
