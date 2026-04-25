/** Rough char-based token estimate. Real tokenization varies by ~20%. Acceptable for budget guards, not for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
