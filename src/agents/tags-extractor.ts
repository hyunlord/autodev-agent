/** 작업 프롬프트에서 태그 추출 */
export function extractTags(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const tags: string[] = [];

  const patterns: Array<[string, RegExp]> = [
    ['frontend', /html|css|react|vue|ui|frontend|component|page|form|button/],
    ['backend', /express|server|api|endpoint|database|sql|rest/],
    ['fullstack', /full.?stack|backend.*frontend|frontend.*backend/],
    ['counter', /counter|\+.*-|increment|decrement/],
    ['todo', /todo|task.?list|checklist/],
    ['calculator', /calculator|calculate|compute|math/],
    ['form', /form|input|validation|submit/],
    ['dashboard', /dashboard|analytics|chart|graph|kpi/],
    ['auth', /login|signin|signup|auth|password/],
    ['design', /glass.?morphism|gradient|animation|3d|smooth/],
    ['typescript', /typescript|\.tsx?|types?|interface/],
    ['test', /test|jest|vitest|mocha|testing/],
    ['bugfix', /fix|bug|error|issue|broken/],
    ['refactor', /refactor|cleanup|reorganize|restructure/],
  ];

  for (const [tag, pattern] of patterns) {
    if (pattern.test(lower)) tags.push(tag);
  }

  return tags;
}

/** 작업 복잡도 추정 */
export function estimateComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
  const wordCount = prompt.split(/\s+/).length;
  const hasMultipleFiles = /\d+\s*files?|multiple|several/i.test(prompt);
  const hasAdvanced = /database|authentication|real.?time|websocket|ci\/cd/i.test(prompt);

  if (wordCount < 30 && !hasMultipleFiles && !hasAdvanced) return 'simple';
  if (wordCount > 100 || hasAdvanced) return 'complex';
  return 'medium';
}
