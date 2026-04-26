import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadFragment,
  loadAllFragments,
  __resetFragmentCache,
  type Fragment,
} from '../fragment-loader';

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

  it('cached array is frozen — push throws in strict mode', () => {
    const fragments = loadAllFragments();
    const before = fragments.length;
    expect(() =>
      (fragments as unknown as Fragment[]).push({
        name: 'x',
        description: '',
        keywords: [],
        body: '',
        estimatedTokens: 0,
      }),
    ).toThrow();
    expect(fragments.length).toBe(before);
  });

  it('cached fragment objects are frozen — property assignment throws', () => {
    const fragments = loadAllFragments();
    const original = fragments[0].body;
    expect(() => {
      (fragments[0] as Fragment).body = 'mutated';
    }).toThrow();
    expect(fragments[0].body).toBe(original);
  });
});
