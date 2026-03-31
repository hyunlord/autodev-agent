export interface PromptPreset {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  prompt: string;
}

export const BUILT_IN_PRESETS: PromptPreset[] = [
  {
    id: 'default',
    name: 'Default',
    emoji: '⚙️',
    tagline: 'Balanced and sensible',
    description: 'No extra instructions. The agent decides the best approach based on the task and existing code.',
    prompt: '',
  },
  {
    id: 'sniper',
    name: 'Sniper',
    emoji: '🎯',
    tagline: 'Surgical precision. Zero waste.',
    description: 'Minimum changes only. No refactoring, no extra files, no unsolicited improvements. If 5 lines solve it, don\'t write 50. Perfect for quick fixes and hotpatches.',
    prompt: `SNIPER MODE — Surgical precision, zero waste.
PLANNING: Generate the shortest possible plan. Only the files that MUST change. No styling details unless explicitly asked. Verification should be minimal — just confirm the change was made.
CODING: Make the MINIMUM changes to complete the task. Do NOT refactor, rename, or reorganize existing code. Do NOT add comments, documentation, or tests unless explicitly requested. Do NOT install new dependencies unless absolutely required. Do NOT add error handling, validation, or edge case coverage unless the task demands it. Touch as few lines as possible.`,
  },
  {
    id: 'artisan',
    name: 'Artisan',
    emoji: '🎨',
    tagline: 'Crafted with care. Every detail matters.',
    description: 'Go beyond the minimum. Add polish, error handling, accessibility, animations, thoughtful naming. The code should feel like a senior engineer wrote it on a good day.',
    prompt: `ARTISAN MODE — Crafted with care, every detail matters.
PLANNING: Generate a thorough plan with rich implementation details. Include styling suggestions, UX improvements, edge cases to handle, and accessibility considerations. The coding prompt should be detailed enough that the result feels polished and professional.
CODING: You have freedom to improve beyond the minimum requirement. Add appropriate error handling with user-friendly messages. Use semantic HTML and ARIA attributes for accessibility. Add smooth transitions and hover effects for interactive elements. Use consistent naming conventions. Add brief, helpful comments for non-obvious logic. Structure code for readability and maintainability. Make it something you'd be proud to show.`,
  },
  {
    id: 'guardian',
    name: 'Guardian',
    emoji: '🛡️',
    tagline: 'Protect what exists. Break nothing.',
    description: 'Maximum caution. Understand before changing. Preserve all existing behavior. Add safety checks. When in doubt, choose the conservative option.',
    prompt: `GUARDIAN MODE — Protect what exists, break nothing.
PLANNING: Generate a conservative plan. Identify what could break and plan around it. The coding prompt must include explicit warnings about what NOT to modify. Prefer additive changes (adding new functions) over modifying existing ones. Verification should test that existing functionality still works.
CODING: Preserve ALL existing functionality — this is the top priority. Before modifying any code, read and understand the full file context first. Add null checks, type guards, and fallbacks wherever there's uncertainty. Prefer creating new functions over modifying existing ones. If an existing function must change, keep backward compatibility. Test your changes mentally before writing them. If you're unsure about a change, implement the safest option even if it's more verbose.`,
  },
  {
    id: 'speed',
    name: 'Speed',
    emoji: '⚡',
    tagline: 'Ship it. Style it later.',
    description: 'Get it working fast. No polish, no extra features, no styling beyond the bare minimum. Functionality over form.',
    prompt: `SPEED MODE — Ship it, style it later.
PLANNING: Generate the fastest path to a working result. Minimal verification — just check it works. Skip visual checks unless the task is specifically about appearance. Prefer single-file solutions.
CODING: Focus on making it WORK, not making it pretty. Skip hover effects, animations, and visual polish unless explicitly asked. Use the simplest approach that achieves the goal. Default styles are fine. Inline styles are fine. No need for responsive design unless asked. Get to a working state as fast as possible.`,
  },
  {
    id: 'experimental',
    name: 'Experimental',
    emoji: '🧪',
    tagline: 'Try something new. Fail fast.',
    description: 'Use cutting-edge patterns, modern APIs, unconventional approaches. It\'s okay to be bold — the user wants to explore, not play it safe.',
    prompt: `EXPERIMENTAL MODE — Try something new, fail fast.
PLANNING: Suggest innovative approaches. Prefer modern APIs (CSS Container Queries, View Transitions API, Web Components) over established patterns when appropriate. The plan can be ambitious — the user is exploring possibilities, not shipping to production.
CODING: Use the newest language features and APIs available. Prefer modern patterns over legacy approaches (e.g., CSS Grid over float, async/await over callbacks, ES modules over CommonJS). Try unconventional solutions if they're more elegant. Add comments explaining why you chose an unusual approach. It's fine to use experimental browser APIs with appropriate fallbacks.`,
  },
];

export function getPreset(id: string): PromptPreset | undefined {
  return BUILT_IN_PRESETS.find(p => p.id === id);
}
