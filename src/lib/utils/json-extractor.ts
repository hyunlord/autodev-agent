/**
 * Extract valid JSON from messy CLI output.
 * 4-stage fallback:
 *   1. Direct JSON.parse
 *   2. Strip markdown fences, then parse
 *   3. Brace-matching extract largest {...} block
 *   4. Line-by-line scan for JSON objects (JSONL, Codex envelope)
 */
export function extractJson<T = any>(raw: string, requiredField?: string): T {
  const attempts: string[] = [];

  // Stage 1: Direct parse
  try {
    const parsed = JSON.parse(raw);
    if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
      return parsed;
    }
    attempts.push('Stage 1: parsed but missing required field');
  } catch (e) {
    attempts.push(`Stage 1: ${(e as Error).message}`);
  }

  // Stage 2: Strip markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
      return parsed;
    }
    attempts.push('Stage 2: parsed but missing required field');
  } catch (e) {
    attempts.push(`Stage 2: ${(e as Error).message}`);
  }

  // Stage 3: Brace-matching — find largest {...} block
  const jsonBlocks = findJsonBlocks(cleaned);
  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
        return parsed;
      }
    } catch { continue; }
  }
  if (jsonBlocks.length > 0) {
    attempts.push(`Stage 3: found ${jsonBlocks.length} JSON blocks but none valid`);
  } else {
    attempts.push('Stage 3: no JSON blocks found');
  }

  // Stage 4: Line-by-line scan (for JSONL / Codex envelope)
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
        return parsed;
      }
      // Codex envelope: { result: "{ ... }" } or { text: "{ ... }" }
      if (parsed.result || parsed.text || parsed.response) {
        const inner = parsed.result ?? parsed.text ?? parsed.response;
        if (typeof inner === 'string') {
          try {
            const innerParsed = JSON.parse(inner);
            if (!requiredField || (innerParsed && typeof innerParsed === 'object' && requiredField in innerParsed)) {
              return innerParsed;
            }
          } catch { /* inner not JSON */ }
        } else if (typeof inner === 'object' && inner !== null) {
          if (!requiredField || (requiredField in inner)) {
            return inner;
          }
        }
      }
    } catch { continue; }
  }
  attempts.push('Stage 4: no valid JSON lines found');

  throw new Error(
    `Failed to extract JSON from CLI output (${raw.length} chars).\n` +
    `Attempts:\n${attempts.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n` +
    `Raw output (first 500 chars):\n${raw.slice(0, 500)}`
  );
}

/**
 * Find JSON-like {...} blocks using brace depth tracking.
 * Returns blocks sorted by length descending (largest first).
 */
function findJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks.sort((a, b) => b.length - a.length);
}
