import { describe, it, expect } from 'vitest';
import { coreExamples, selectExamples } from '../examples';

describe('coreExamples', () => {
  it('contains exactly 5 examples', () => {
    expect(coreExamples).toHaveLength(5);
  });

  it('every example reports a positive token estimate', () => {
    for (const ex of coreExamples) {
      expect(ex.estimatedTokens, `${ex.id} estimatedTokens`).toBeGreaterThan(0);
    }
  });

  it('total estimated tokens fits the few-shot budget (< 4000)', () => {
    const total = coreExamples.reduce((acc, ex) => acc + ex.estimatedTokens, 0);
    expect(total).toBeLessThan(4000);
  });

  it('every non-clarify example produces a non-null generated_yaml', () => {
    for (const ex of coreExamples) {
      if (ex.intent === 'clarify') continue;
      expect(ex.expectedResponse.generated_yaml, `${ex.id}`).toBeTruthy();
    }
  });

  it('clarify example has questions and null yaml', () => {
    const clarify = coreExamples.find((e) => e.intent === 'clarify');
    expect(clarify).toBeDefined();
    expect(clarify!.expectedResponse.needs_clarification).toBe(true);
    expect(clarify!.expectedResponse.generated_yaml).toBeNull();
    expect(clarify!.expectedResponse.clarification_questions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('selectExamples', () => {
  it("intent='new' puts 'new' examples first", () => {
    const out = selectExamples('new', []);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].intent).toBe('new');
  });

  it("intent='clarify' returns the clarify example first", () => {
    const out = selectExamples('clarify', []);
    expect(out[0].id).toBe('clarify-build');
  });

  it('respects the token budget (does not blow past 3500 once seeded)', () => {
    const out = selectExamples('new', []);
    const total = out.reduce((acc, ex) => acc + ex.estimatedTokens, 0);
    expect(total).toBeLessThanOrEqual(3500);
  });

  it('always returns at least one example', () => {
    const out = selectExamples('explain', []);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});
