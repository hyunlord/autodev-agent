import type { Fragment } from './fragment-loader';

export interface FragmentMatch {
  fragmentName: string;
  matchedKeywords: string[];
  score: number;
}

export interface DetectOptions {
  /** Hard cap on returned matches. Default 3 — protects the LLM token budget. */
  maxFragments?: number;
}

/**
 * Lower-cased substring match. v1 is intentionally simple — covers Korean
 * (substring) and English (substring) without word-boundary heuristics.
 * Stable sort: ties preserve the order of `fragments[]`.
 */
export function detectFragments(
  userMessage: string,
  fragments: Fragment[],
  options: DetectOptions = {},
): FragmentMatch[] {
  const max = options.maxFragments ?? 3;
  const haystack = userMessage.toLowerCase();

  const matches: FragmentMatch[] = [];
  for (const fragment of fragments) {
    const matchedKeywords: string[] = [];
    for (const keyword of fragment.keywords) {
      const needle = keyword.toLowerCase();
      if (needle && haystack.includes(needle)) {
        matchedKeywords.push(keyword);
      }
    }
    if (matchedKeywords.length > 0) {
      matches.push({
        fragmentName: fragment.name,
        matchedKeywords,
        score: matchedKeywords.length,
      });
    }
  }

  return matches
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)
    .map(({ m }) => m)
    .slice(0, max);
}
