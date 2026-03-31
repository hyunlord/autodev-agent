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
  waitMs: z.coerce.number().optional(),
  expectedStdout: z.string().optional(),
  expectedExitCode: z.coerce.number().optional(),
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
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
): Promise<Plan> {
  onProgress?.('Generating plan via coding agent CLI...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const planPrompt = `You are a development planning assistant. Generate a JSON plan for modifying an EXISTING project.

## Project Context
${projectContext}

## Existing Files in Workspace
${workspaceContext ?? 'No files yet (empty workspace).'}

## Task
${userPrompt}

## STRICT RULES — VIOLATIONS WILL CAUSE TASK FAILURE

RULE 1 — TECHNOLOGY MATCH:
- Project type "${projectConfig?.type ?? 'unknown'}" determines what technology to use.
- "static-html" or "unknown" with only .html/.css/.js files → modify those files directly using plain HTML/CSS/JS. Do NOT use React, Next.js, Vue, or any framework.
- "nextjs" → modify existing Next.js files (src/app/, etc.)
- "react" → modify existing React files
- If the workspace has index.html and no package.json, the ONLY correct approach is to edit index.html.

RULE 2 — NO NEW PROJECTS:
- NEVER create a new project structure (no npx create-next-app, no npm init, no framework scaffolding).
- NEVER create src/app/, src/components/, or similar framework directories unless they already exist.
- Modify ONLY files that already exist, or create new files that match the existing technology.

RULE 3 — FILE PATHS:
- Use ONLY relative paths (./index.html, ./styles.css).
- NEVER use absolute paths (/Users/..., /home/...).
- The coding agent's working directory is already set to the project root.

RULE 4 — CODING PROMPT CONTENT:
- The codingPrompt must name the EXACT files to modify (from the file list above).
- If the task says "이 페이지" or "this page", it refers to the existing HTML/page file in the workspace, NOT some external application.
- Include specific code changes (what to add, where to add it).
- Tell the agent to keep all existing functionality intact.

RULE 5 — VERIFICATION:
- If project has no package.json: use file_check ONLY. No build_check, no port_check, no http_check.
- file_check must use filePath AND expectedText to verify the change was actually made.
- For HTML files, expectedText should check for the new feature (e.g., a button class, a CSS property).

RULE 6 — LANGUAGE:
- The "summary" field must be in the SAME language as the user's task description.
- If the task is in Korean, summary must be in Korean.
- If the task is in English, summary must be in English.
- The "codingPrompt" should stay in English (better for coding agents).
- Verification step descriptions should be in English (for consistency).

Respond with ONLY valid JSON:
{
  "summary": "One-line summary",
  "codingPrompt": "Specific instructions referencing exact files from the workspace",
  "estimatedFiles": ["index.html"],
  "verificationSpec": {
    "steps": [
      {"id": "v1", "description": "index.html contains dark mode toggle", "type": "file_check", "filePath": "index.html", "expectedText": "dark-mode"}
    ]
  }
}`;

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const claudePath = await resolveCli('claude');
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }
  const result = await execa(claudePath, [
    '-p', systemPrompt ? `${systemPrompt}\n\n${planPrompt}` : planPrompt,
    '--output-format', 'text',
    '--max-turns', '5',
    '--dangerously-skip-permissions',
  ], {
    cwd: workspaceDir,
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
  workspaceContext?: string,
  systemPrompt?: string | null,
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
    system: `${systemPrompt ? systemPrompt + '\n\n' : ''}You are a development planning assistant. Generate a JSON plan for modifying an EXISTING project.

## STRICT RULES — VIOLATIONS WILL CAUSE TASK FAILURE

RULE 1 — TECHNOLOGY MATCH:
- The project type is provided in the user message. Match it exactly.
- "static-html" or "unknown" with .html/.css/.js files → plain HTML/CSS/JS only. NO frameworks.
- "nextjs" → modify existing Next.js files. "react" → modify existing React files.
- If the workspace has index.html and no package.json, edit index.html directly.

RULE 2 — NO NEW PROJECTS:
- NEVER create new project structures. Modify existing files only.
- NEVER add frameworks that don't already exist in the project.

RULE 3 — FILE PATHS:
- Use ONLY relative paths. NEVER use absolute paths.

RULE 4 — CODING PROMPT:
- Name exact files to modify from the workspace file list.
- "이 페이지" / "this page" = the existing page file in the workspace.
- Include specific code changes.

RULE 5 — VERIFICATION:
- No package.json → file_check ONLY (no build_check, port_check, http_check).
- file_check must include filePath AND expectedText.

RULE 6 — LANGUAGE:
- "summary" must match the language of the user's task (Korean task → Korean summary, English task → English summary).
- "codingPrompt" stays in English.
- Verification descriptions stay in English.

Your response MUST be valid JSON:
{
  "summary": "One-line summary",
  "codingPrompt": "Specific instructions for exact files",
  "estimatedFiles": ["file.html"],
  "verificationSpec": {
    "steps": [
      {"id": "v1", "description": "what to check", "type": "file_check", "filePath": "file.html", "expectedText": "expected content"}
    ]
  }
}

Verification types (use ONLY what's appropriate):
- file_check — file exists with expected content (ALWAYS use for static HTML projects)
- build_check — only if package.json exists with build script
- port_check, http_check, dom_check — only if project has a dev server
- vlm_check — visual verification via screenshot
- desktop_check — GUI app screenshot
- cli_output_check — command output verification

Respond with ONLY the JSON object, no markdown code fences, no explanation.`,
    messages: [
      {
        role: 'user',
        content: `Task: ${userPrompt}\n\n${projectContext}${workspaceContext ? `\n${workspaceContext}` : ''}`,
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
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
): Promise<Plan> {
  switch (mode) {
    case 'auto':
      return planViaCliAgent(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt);

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
      return planViaApi(userPrompt, projectConfig, onProgress, workspaceContext, systemPrompt);

    default:
      throw new Error(`Unknown planning mode: ${mode}`);
  }
}
