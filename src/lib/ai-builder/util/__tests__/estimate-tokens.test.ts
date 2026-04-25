import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { estimateTokens } from '../estimate-tokens';

describe('estimateTokens', () => {
  it('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('100 ASCII chars → 25', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });

  it('1000 Korean chars → 250 (over-estimates real tokenization, safe for budget guard)', () => {
    expect(estimateTokens('가'.repeat(1000))).toBe(250);
  });

  it('base-spec.md fits within 4E §4.1 budget (< 2500 tokens)', () => {
    const path = join(process.cwd(), '.autodev', 'agents', 'ai-builder-base-spec.md');
    const content = readFileSync(path, 'utf-8');
    const tokens = estimateTokens(content);
    expect(tokens).toBeLessThan(2500);
    expect(tokens).toBeGreaterThan(0);
  });
});
