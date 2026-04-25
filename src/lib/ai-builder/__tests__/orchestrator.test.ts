import { describe, it, expect } from 'vitest';
import { AIBuilderOrchestrator } from '../orchestrator';

describe('AIBuilderOrchestrator (G19-1 skeleton)', () => {
  it('intent="new" when currentYaml is absent', async () => {
    const o = new AIBuilderOrchestrator();
    const result = await o.run({
      userMessage: 'create a new pipeline',
      projectId: 'p1',
    });
    expect(result.intent).toBe('new');
    expect(result.steps).toContain('classify_intent');
    expect(result.steps).toContain('assemble_context');
  });

  it('intent="modify" when currentYaml is provided', async () => {
    const o = new AIBuilderOrchestrator();
    const result = await o.run({
      userMessage: 'add a step',
      projectId: 'p1',
      currentYaml:
        'adplVersion: 1\nname: x\npipeline:\n  - id: a\n    type: shell\n    command: echo\n',
    });
    expect(result.intent).toBe('modify');
  });

  it('skeleton warns that LLM is not wired and reports zero attempts', async () => {
    const o = new AIBuilderOrchestrator();
    const result = await o.run({
      userMessage: 'anything',
      projectId: 'p1',
    });
    expect(result.warnings.some((w) => w.includes('not implemented'))).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.steps).not.toContain('call_llm');
  });
});
