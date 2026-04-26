import type { AIBuilderRequest, IntentClassification } from '../types';

/**
 * Build the TASK section of the AI Builder system prompt — the per-call,
 * intent-dispatched portion. Pure function, no I/O.
 */
export function buildTaskSection(
  req: AIBuilderRequest,
  classification: IntentClassification,
): string {
  const userMessage = req.userMessage.trim();

  switch (classification.intent) {
    case 'new':
      return [
        'Task: Generate a new ADPL pipeline that satisfies the user\'s request below.',
        '',
        `User request: ${userMessage}`,
      ].join('\n');

    case 'modify': {
      const yaml = req.currentYaml?.trim() || '(no YAML provided — treat as new)';
      return [
        'Task: Modify the existing ADPL pipeline. Preserve all unrelated structure. Apply only the changes the user explicitly asks for. Populate the diff field with added/removed/modified node ids.',
        '',
        `User request: ${userMessage}`,
        '',
        'Current YAML:',
        '```yaml',
        yaml,
        '```',
      ].join('\n');
    }

    case 'clarify':
      return [
        "Task: The user's request is too vague to generate a pipeline reliably. Ask 1-3 specific clarifying questions before producing YAML. Set needs_clarification: true and leave generated_yaml as null.",
        '',
        `User request: ${userMessage}`,
      ].join('\n');

    case 'explain': {
      const yaml = req.currentYaml?.trim() || '(no YAML provided)';
      return [
        'Task: Explain the existing pipeline or specific node behavior. Do NOT modify the YAML — set intent_recognized to "explain" and return the same generated_yaml unchanged (or null if no YAML exists).',
        '',
        `User question: ${userMessage}`,
        '',
        'Current YAML:',
        '```yaml',
        yaml,
        '```',
      ].join('\n');
    }
  }
}
