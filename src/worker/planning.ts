import { z } from 'zod';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { PlanningMode } from '../lib/types';
import { resolveCli } from '../lib/cli-resolver';

// ─── Schemas (unchanged) ──────────────────────────────────────

export const VerificationStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['build_check', 'port_check', 'http_check', 'file_check', 'dom_check', 'vlm_check', 'desktop_check', 'cli_output_check']),
  command: z.string().optional(),
  url: z.string().optional(),
  filePath: z.string().optional(),
  selector: z.string().optional(),
  expectedText: z.string().optional(),
  vlmPrompt: z.string().optional(),
  runCmd: z.string().optional(),
  waitMs: z.number().optional(),
  expectedStdout: z.string().optional(),
  expectedExitCode: z.number().optional(),
  notExpectedStdout: z.string().optional(),
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

// ─── Mode A: Auto Planning via CLI ────────────────────────────

async function planViaCliAgent(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
): Promise<Plan> {
  onProgress?.('Generating plan via coding agent CLI...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const planPrompt = `You are a development planning assistant. Analyze this task and generate a JSON plan.

Task: ${userPrompt}

${projectContext}

Respond with ONLY a valid JSON object (no markdown, no explanation) with this structure:
{
  "summary": "One-line summary",
  "codingPrompt": "Detailed instruction for a coding agent including exact file paths and implementation details",
  "estimatedFiles": ["file1.ts", "file2.ts"],
  "verificationSpec": {
    "steps": [
      { "id": "v1", "description": "Build succeeds", "type": "build_check", "command": "npm run build" }
    ]
  }
}

Verification step types: build_check, file_check, port_check, http_check, dom_check, vlm_check.
Order from cheapest to most expensive. Always include build_check first.
7. desktop_check — launch a desktop/GUI app, wait for rendering, take a screenshot (for Godot, Electron, native apps). Use runCmd and optional vlmPrompt.
8. cli_output_check — run a command and verify stdout/stderr/exit code (for CLI tools, scripts). Use command, expectedStdout, expectedExitCode.`;

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const claudePath = await resolveCli('claude');
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }
  const result = await execa(claudePath, [
    '-p', planPrompt,
    '--output-format', 'text',
    '--max-turns', '5',
    '--dangerously-skip-permissions',
  ], {
    timeout: 120_000,
    reject: false,
    env: { ...process.env },
  });

  if (result.exitCode !== 0) {
    const debugOutput = [
      result.stderr ? `stderr: ${result.stderr.slice(0, 1000)}` : '',
      result.stdout ? `stdout: ${result.stdout.slice(0, 1000)}` : '',
    ].filter(Boolean).join('\n');
    throw new Error(`CLI planning failed (exit ${result.exitCode}):\n${debugOutput}`);
  }

  const cleaned = result.stdout.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`CLI returned non-JSON output (${cleaned.length} chars):\n${cleaned.slice(0, 1000)}`);
    }
  }

  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${cleaned.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  return plan;
}

// ─── Mode B: Manual Planning ──────────────────────────────────

function planFromManualInput(
  codingPrompt: string,
  verificationChecklist: string,
  onProgress?: (msg: string) => void,
): Plan {
  onProgress?.('Using manually provided plan...');

  const lines = verificationChecklist
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(Boolean);

  const steps = lines.map((line, i) => ({
    id: `v${i + 1}`,
    description: line,
    type: guessVerificationType(line),
    vlmPrompt: line,
  }));

  if (!steps.some(s => s.type === 'build_check')) {
    steps.unshift({
      id: 'v0',
      description: 'Project builds without errors',
      type: 'build_check' as const,
      vlmPrompt: undefined as any,
    });
  }

  const plan: Plan = {
    summary: codingPrompt.slice(0, 100) + (codingPrompt.length > 100 ? '...' : ''),
    codingPrompt,
    estimatedFiles: [],
    verificationSpec: { steps: steps as any },
  };

  onProgress?.('Manual plan loaded');
  return plan;
}

function guessVerificationType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes('build') || lower.includes('compile') || lower.includes('error')) return 'build_check';
  if (lower.includes('file') || lower.includes('exist') || lower.includes('create')) return 'file_check';
  if (lower.includes('port') || lower.includes('server') || lower.includes('start')) return 'port_check';
  if (lower.includes('http') || lower.includes('200') || lower.includes('load')) return 'http_check';
  if (lower.includes('button') || lower.includes('text') || lower.includes('element') || lower.includes('selector')) return 'dom_check';
  if (lower.includes('launch') || lower.includes('window') || lower.includes('render') || lower.includes('display') || lower.includes('gui') || lower.includes('game')) return 'desktop_check';
  if (lower.includes('output') || lower.includes('stdout') || lower.includes('print') || lower.includes('exit code') || lower.includes('return') || lower.includes('run')) return 'cli_output_check';
  return 'vlm_check';
}

// ─── Mode C: API Planning ─────────────────────────────────────

async function planViaApi(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
): Promise<Plan> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  onProgress?.('Generating plan via Claude API...');

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
7. desktop_check — launch a desktop/GUI app, wait for rendering, take a screenshot (for Godot, Electron, native apps). Use runCmd and optional vlmPrompt.
8. cli_output_check — run a command and verify stdout/stderr/exit code (for CLI tools, scripts). Use command, expectedStdout, expectedExitCode.

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

// ─── Main Entry Point ──────────────────────────────────────────

export async function generatePlan(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  mode: PlanningMode,
  manualInput?: { codingPrompt: string; verificationChecklist: string },
  onProgress?: (msg: string) => void,
): Promise<Plan> {
  switch (mode) {
    case 'auto':
      return planViaCliAgent(userPrompt, projectConfig, onProgress);

    case 'manual':
      if (!manualInput?.codingPrompt) {
        throw new Error('Manual mode requires codingPrompt');
      }
      return planFromManualInput(
        manualInput.codingPrompt,
        manualInput.verificationChecklist ?? '',
        onProgress,
      );

    case 'api':
      return planViaApi(userPrompt, projectConfig, onProgress);

    default:
      throw new Error(`Unknown planning mode: ${mode}`);
  }
}
