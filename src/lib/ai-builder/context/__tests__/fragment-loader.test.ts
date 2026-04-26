import { describe, it, expect, beforeEach } from 'vitest';
import { loadFragment, loadAllFragments, __resetFragmentCache } from '../fragment-loader';

beforeEach(() => {
  __resetFragmentCache();
});

describe('loadFragment', () => {
  it('loads parallel fragment with name / description / keywords / body', () => {
    const f = loadFragment('parallel');
    expect(f.name).toBe('parallel');
    expect(f.description).toContain('Parallel');
    expect(f.keywords).toContain('parallel');
    expect(f.keywords).toContain('병렬');
    expect(f.body.length).toBeGreaterThan(0);
    expect(f.estimatedTokens).toBeGreaterThan(0);
  });

  it('throws a clear error for a non-existent fragment', () => {
    expect(() => loadFragment('does-not-exist')).toThrow(/not found/);
  });
});

describe('loadAllFragments', () => {
  it('returns all 7 fragments', () => {
    const all = loadAllFragments();
    const names = all.map((f) => f.name).sort();
    expect(names).toEqual([
      'gate-human',
      'git-event-trigger',
      'loop-patterns',
      'mcp-integration',
      'parallel',
      'schedule-trigger',
      'webhook-providers',
    ]);
  });

  it('every fragment fits within 4E §4.3 budget (< 600 tokens)', () => {
    const all = loadAllFragments();
    for (const f of all) {
      expect(f.estimatedTokens, `${f.name} over budget: ${f.estimatedTokens} tokens`)
        .toBeLessThan(600);
    }
  });

  it('every fragment has at least one keyword', () => {
    const all = loadAllFragments();
    for (const f of all) {
      expect(f.keywords.length, `${f.name} has no keywords`).toBeGreaterThan(0);
    }
  });
});
