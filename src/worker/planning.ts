import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ProjectConfig } from '../lib/detection/project-type';

export const VerificationStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['build_check', 'port_check', 'http_check', 'file_check', 'dom_check', 'vlm_check']),
  command: z.string().optional(),
  url: z.string().optional(),
  filePath: z.string().optional(),
  selector: z.string().optional(),
  expectedText: z.string().optional(),
  vlmPrompt: z.string().optional(),
});

export const VerificationSpecSchema = z.object({
  steps: z.array(VerificationStepSchema),
});

export type VerificationSpec = z.infer<typeof VerificationSpecSchema>;
export type VerificationStep = z.infer<typeof VerificationStepSchema>;

export const PlanSchema = z.object({
  summary: z.string(),
  codingPrompt: z.string(),
  estimatedFiles: z.array(z.string()),
  verificationSpec: VerificationSpecSchema,
});

export type Plan = z.infer<typeof PlanSchema>;

export async function generatePlan(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
): Promise<Plan> {
  const anthropic = new Anthropic();

  onProgress?.('Analyzing task and generating plan...');

  const projectContext = projectConfig
    ? `Project type: ${projectConfig.displayName} (${projectConfig.language})
Build command: ${projectConfig.buildCmd ?? 'none'}
Dev command: ${projectConfig.devCmd}
Default port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown (no project detected)';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0.1,
    system: `You are a development planning assistant. Given a user's task description and project context, generate a structured plan.

Your response MUST be valid JSON matching this schema:
{
  "summary": "One-line summary of what will be done",
  "codingPrompt": "Detailed, specific instruction for a coding agent. Include exact file paths, code patterns, and implementation details. Be thorough — the coding agent only sees this prompt, not the original user request.",
  "estimatedFiles": ["list", "of", "files", "to", "modify"],
  "verificationSpec": {
    "steps": [
      {
        "id": "v1",
        "description": "What this checks",
        "type": "build_check|port_check|http_check|file_check|dom_check|vlm_check",
        "command": "optional: shell command for build_check",
        "url": "optional: URL for http_check",
        "filePath": "optional: path for file_check",
        "selector": "optional: CSS selector for dom_check",
        "expectedText": "optional: expected text content",
        "vlmPrompt": "optional: natural language description for VLM to verify visually"
      }
    ]
  }
}

Verification steps should be ordered from cheapest to most expensive:
1. build_check — does it compile/build without errors?
2. file_check — do the expected files exist with expected content?
3. port_check — does the dev server start and listen on the expected port?
4. http_check — does the page load with HTTP 200?
5. dom_check — does the page contain expected elements/text?
6. vlm_check — does the page visually match the expectation? (natural language)

Always include at least a build_check. Include vlm_check only when there's a visual aspect to verify.

Respond with ONLY the JSON object, no markdown code fences, no explanation.`,
    messages: [
      {
        role: 'user',
        content: `Task: ${userPrompt}\n\n${projectContext}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  let parsed: unknown;
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Planning LLM returned invalid JSON: ${text.slice(0, 500)}`);
  }

  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Plan ready: ${plan.summary}`);
  return plan;
}
