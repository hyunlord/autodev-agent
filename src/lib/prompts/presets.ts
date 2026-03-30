export interface PromptPreset {
  id: string;
  name: string;
  description: string;
  planningPrompt: string;
  codingPrompt: string;
}

export const BUILT_IN_PRESETS: PromptPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Balanced — respects existing files, avoids over-engineering',
    planningPrompt: '',
    codingPrompt: '',
  },
  {
    id: 'strict',
    name: 'Strict',
    description: 'Minimal changes only — never create new files unless explicitly asked',
    planningPrompt: '',
    codingPrompt: `STRICT MODE:
- Make the MINIMUM changes needed to complete the task.
- Do NOT refactor, rename, or reorganize existing code.
- Do NOT add comments unless the task asks for them.
- Do NOT install new dependencies unless absolutely required.
- If a feature can be added with 5 lines, do NOT write 50.`,
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'More freedom — can restructure, add polish, suggest improvements',
    planningPrompt: '',
    codingPrompt: `CREATIVE MODE:
- You have freedom to improve the code beyond the minimum requirement.
- Add appropriate error handling, comments, and edge case coverage.
- Use modern patterns and best practices.
- Suggest improvements if you see opportunities.
- Make the UI polished and professional if applicable.`,
  },
  {
    id: 'careful',
    name: 'Careful',
    description: 'Extra cautious — preserve all existing behavior',
    planningPrompt: '',
    codingPrompt: `CAREFUL MODE:
- Preserve ALL existing functionality. Do not break anything.
- Before modifying a file, understand its full context first.
- Test your changes mentally before writing them.
- If unsure about a change, implement the safest option.
- Add backup/rollback mechanisms where appropriate.`,
  },
];

export function getPreset(id: string): PromptPreset | undefined {
  return BUILT_IN_PRESETS.find(p => p.id === id);
}
