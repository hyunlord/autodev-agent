import { describe, it, expect } from 'vitest';
import { detectFragments } from '../keyword-detector';
import { loadAllFragments } from '../fragment-loader';

const FRAGMENTS = loadAllFragments();

function names(matches: ReturnType<typeof detectFragments>): string[] {
  return matches.map((m) => m.fragmentName);
}

describe('detectFragments', () => {
  it('Korean schedule cue matches schedule-trigger', () => {
    const out = detectFragments('매일 9시에 실행해줘', FRAGMENTS);
    expect(names(out)).toContain('schedule-trigger');
  });

  it('PR + alert cues match git-event-trigger and webhook-providers', () => {
    const out = detectFragments('PR 열리면 Slack 으로 알림', FRAGMENTS);
    const got = names(out);
    expect(got).toContain('git-event-trigger');
    expect(got).toContain('webhook-providers');
  });

  it('Slack cue alone matches webhook-providers', () => {
    const out = detectFragments('Slack 으로 보내줘', FRAGMENTS);
    expect(names(out)).toContain('webhook-providers');
  });

  it('parallel cue matches parallel fragment', () => {
    const out = detectFragments('lint, test, typecheck 를 병렬로 실행', FRAGMENTS);
    expect(names(out)).toContain('parallel');
  });

  it('empty / unrelated message → no matches', () => {
    expect(detectFragments('hello world', FRAGMENTS)).toEqual([]);
    expect(detectFragments('', FRAGMENTS)).toEqual([]);
  });

  it('maxFragments=2 caps results when more match', () => {
    const out = detectFragments('매일 PR 머지 후 Slack 알림', FRAGMENTS, { maxFragments: 2 });
    expect(out.length).toBe(2);
    // Top scorers should still appear; exact order is by score desc, ties stable.
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });
});
