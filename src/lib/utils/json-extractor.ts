/**
 * Extract valid JSON from messy CLI output.
 * 5-stage fallback:
 *   1. Direct JSON.parse
 *   2. Strip markdown fences, then parse
 *   3. Brace-matching extract largest {...} block
 *   3.5. Codex JSONL event stream — extract text from item.completed/agent_message
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

  // Stage 3.5: Codex CLI JSONL event stream
  // Codex --json outputs {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
  // The actual response (and plan JSON) lives inside item.text
  {
    const jsonlLines = raw.split('\n');
    const agentTexts: string[] = [];
    for (const line of jsonlLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'item.completed') {
          if (
            (event.item?.type === 'agent_message' || event.item?.type === 'result') &&
            typeof event.item?.text === 'string'
          ) {
            agentTexts.push(event.item.text);
          }
        }
        // response.completed with output array
        if (event.type === 'response.completed' && Array.isArray(event.response?.output)) {
          for (const out of event.response.output) {
            if (out.type === 'message' && typeof out.text === 'string') {
              agentTexts.push(out.text);
            }
          }
        }
      } catch { continue; }
    }

    if (agentTexts.length > 0) {
      // Try each agent text from last to first (final message is most likely the plan)
      for (let i = agentTexts.length - 1; i >= 0; i--) {
        const text = agentTexts[i];
        // Direct parse
        try {
          const parsed = JSON.parse(text);
          if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
            return parsed;
          }
        } catch { /* not bare JSON */ }
        // Extract from within text (may be wrapped in markdown fences, prose, etc.)
        const innerBlocks = findJsonBlocks(text);
        for (const block of innerBlocks) {
          try {
            const parsed = JSON.parse(block);
            if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
              return parsed;
            }
          } catch { continue; }
        }
      }
      // Last resort: combine all texts and try brace-matching
      const combined = agentTexts.join('\n');
      for (const block of findJsonBlocks(combined)) {
        try {
          const parsed = JSON.parse(block);
          if (!requiredField || (parsed && typeof parsed === 'object' && requiredField in parsed)) {
            return parsed;
          }
        } catch { continue; }
      }
      attempts.push(`Stage 3.5: found ${agentTexts.length} agent message(s) but no valid JSON`);
    }
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

  // Stage 5: Regex fallback — extract verdict/score from natural language
  if (requiredField === 'verdict') {
    const verdictMatch = raw.match(/["']?verdict["']?\s*[:=]\s*["']?(pass|fail|re-code|re-plan)["']?/i);
    const scoreMatch = raw.match(/["']?score["']?\s*[:=]\s*(\d+)/i);

    if (verdictMatch || scoreMatch) {
      const verdict = (verdictMatch?.[1]?.toLowerCase() ?? 'pass') as string;
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : (verdict === 'pass' ? 70 : 40);
      attempts.push(`Stage 5: regex extracted verdict=${verdict}, score=${score}`);
      return {
        passed: verdict === 'pass',
        score: Math.min(score, 100),
        reason: `Extracted via regex fallback from ${raw.length} char response`,
        issues: extractListItems(raw, /issues?|problems?|bugs?/i),
        suggestions: extractListItems(raw, /suggestions?|fix|recommend/i),
        verdict,
        evidence: {},
      } as T;
    }

    // Sentiment fallback — detect positive/negative tone
    const positivePatterns = /\b(pass|passes|passed|approved|looks good|no issues|all correct|well.?implemented|satisf)/i;
    const negativePatterns = /\b(fail|fails|failed|reject|issues found|bugs? found|broken|incorrect|missing feature)/i;

    if (positivePatterns.test(raw) || negativePatterns.test(raw)) {
      const isPositive = positivePatterns.test(raw) && !negativePatterns.test(raw);
      attempts.push(`Stage 5: sentiment fallback (${isPositive ? 'positive' : 'negative'})`);
      return {
        passed: isPositive,
        score: isPositive ? 70 : 40,
        reason: `Sentiment analysis fallback from ${raw.length} char response`,
        issues: isPositive ? [] : extractListItems(raw, /issues?|problems?|bugs?/i),
        suggestions: extractListItems(raw, /suggestions?|fix|recommend/i),
        verdict: isPositive ? 'pass' : 're-code',
        evidence: {},
      } as T;
    }

    attempts.push('Stage 5: no verdict/score patterns or sentiment found');
  }

  throw new Error(
    `Failed to extract JSON from CLI output (${raw.length} chars).\n` +
    `Attempts:\n${attempts.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n` +
    `Raw output (first 500 chars):\n${raw.slice(0, 500)}`
  );
}

/**
 * Extract list items near a section header pattern.
 * Looks for numbered/bulleted items after a header matching the pattern.
 */
function extractListItems(text: string, headerPattern: RegExp): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (headerPattern.test(trimmed) && (trimmed.includes(':') || trimmed.startsWith('#'))) {
      capturing = true;
      continue;
    }
    if (capturing) {
      // Numbered or bulleted list item
      const match = trimmed.match(/^[\d]+[.)]\s*(.+)|^[-*•]\s*(.+)/);
      if (match) {
        items.push((match[1] ?? match[2]).trim());
      } else if (trimmed === '' || trimmed.startsWith('#')) {
        capturing = false; // End of section
      }
    }
  }

  return items.slice(0, 10); // Cap at 10 items
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
