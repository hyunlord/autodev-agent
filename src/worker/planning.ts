import { z } from 'zod';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { PlanningMode } from '../lib/types';
import { resolveCli } from '../lib/cli-resolver';
import { loadPrompt } from '../lib/harness/prompt-loader';
import { extractJson } from '../lib/utils/json-extractor';

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

export const SubTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  codingPrompt: z.string(),
  files: z.array(z.string()),
  agent: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const AcceptanceCriteriaSchema = z.object({
  build: z.object({
    commands: z.array(z.string()),
    mustPass: z.boolean().default(true),
  }).optional(),
  requiredFiles: z.array(z.string()).optional(),
  ui: z.object({
    routes: z.array(z.object({
      path: z.string(),
      mustHaveElements: z.array(z.string()).optional(),
      interactions: z.array(z.object({
        action: z.string(),
        assert: z.string(),
      })).optional(),
    })).optional(),
  }).optional(),
  design: z.object({
    minVlmScore: z.number().optional(),
  }).optional(),
}).optional();

export const PlanSchema = z.object({
  summary: z.string(),
  taskCategory: z.string().optional(),
  recommendedAgent: z.string().optional(),
  codingPrompt: z.string(),
  subTasks: z.array(SubTaskSchema).optional(),
  estimatedFiles: z.array(z.string()),
  verificationSpec: VerificationSpecSchema,
  acceptanceCriteria: AcceptanceCriteriaSchema,
});

export type Plan = z.infer<typeof PlanSchema>;
export type SubTask = z.infer<typeof SubTaskSchema>;

export interface PlanResult {
  plan: Plan;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Mode A: Planning via Claude CLI ─────────────────────────

async function planViaCliAgent(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
  timeoutMs?: number,
): Promise<PlanResult> {
  onProgress?.('Generating plan via coding agent CLI...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const plannerPrompt = loadPrompt('planner', workspaceDir, {
    projectContext,
    workspaceContext: workspaceContext ?? 'No files yet (empty workspace).',
    userPrompt,
    projectType: projectConfig?.type ?? 'unknown',
  });
  onProgress?.(`Planner prompt: ${plannerPrompt.source}${plannerPrompt.filePath ? ` (${plannerPrompt.filePath})` : ' (built-in)'}`);

  const planPrompt = systemPrompt ? `${systemPrompt}\n\n${plannerPrompt.content}` : plannerPrompt.content;

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const claudePath = await resolveCli('claude');
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  const effectiveTimeout = timeoutMs ?? 120_000;
  onProgress?.(`[CLI] prompt length: ${planPrompt.length} chars (~${Math.ceil(planPrompt.length / 4)} tokens), timeout: ${effectiveTimeout / 1000}s`);
  const cliStartTime = Date.now();

  const result = await execa(claudePath, [
    '--output-format', 'text',
    '--max-turns', '5',
    '--dangerously-skip-permissions',
  ], {
    cwd: workspaceDir,
    timeout: effectiveTimeout,
    reject: false,
    input: planPrompt,
    env: { ...process.env },
  });

  const cliElapsed = ((Date.now() - cliStartTime) / 1000).toFixed(1);
  onProgress?.(`[CLI] done in ${cliElapsed}s, exit: ${result.exitCode}`);

  if (result.exitCode !== 0) {
    const isTimeout = result.exitCode === 143 || (result as any).timedOut === true;
    const exitReason = isTimeout ? `TIMEOUT after ${cliElapsed}s (limit: ${effectiveTimeout / 1000}s)` : `exit ${result.exitCode}`;
    const debugOutput = [
      result.stderr ? `stderr: ${result.stderr.slice(0, 1000)}` : '',
      result.stdout ? `stdout: ${result.stdout.slice(0, 1000)}` : '',
    ].filter(Boolean).join('\n');
    throw new Error(`CLI planning failed (${exitReason}):\n${debugOutput}`);
  }

  const parsed = extractJson(result.stdout, 'summary');
  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${result.stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const estimatedInputTokens = Math.ceil(planPrompt.length / 4);
  const estimatedOutputTokens = Math.ceil(result.stdout.length / 4);
  return {
    plan,
    costUsd: (estimatedInputTokens / 1_000_000) * 3.0 + (estimatedOutputTokens / 1_000_000) * 15.0,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  };
}

// ─── Mode A2: Planning via Gemini CLI ────────────────────────

async function planViaGeminiCli(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
): Promise<PlanResult> {
  onProgress?.('Generating plan via Gemini CLI...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const plannerPrompt = loadPrompt('planner', workspaceDir, {
    projectContext,
    workspaceContext: workspaceContext ?? 'No files yet (empty workspace).',
    userPrompt,
    projectType: projectConfig?.type ?? 'unknown',
  });
  onProgress?.(`Planner prompt: ${plannerPrompt.source}${plannerPrompt.filePath ? ` (${plannerPrompt.filePath})` : ' (built-in)'}`);

  const planPrompt = systemPrompt ? `${systemPrompt}\n\n${plannerPrompt.content}` : plannerPrompt.content;

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const geminiPath = await resolveCli('gemini');
  if (!geminiPath) {
    throw new Error('Gemini CLI not found. Install with: npm install -g @google/generative-ai or equivalent');
  }

  const result = await execa(geminiPath, [
    '--output-format', 'json',
    '-y',
  ], {
    cwd: workspaceDir,
    timeout: 120_000,
    reject: false,
    input: planPrompt,
    env: { ...process.env },
  });

  if (result.exitCode !== 0) {
    throw new Error(`Gemini CLI planning failed (exit ${result.exitCode}): ${result.stderr?.slice(0, 500)}`);
  }

  // Gemini may wrap output in a JSON envelope with a `response` field
  let stdout = result.stdout;
  try {
    const envelope = JSON.parse(stdout);
    stdout = envelope.response ?? envelope.result ?? envelope.text ?? stdout;
  } catch {
    // Not a JSON envelope, use raw output
  }

  const parsed = extractJson(stdout, 'summary');
  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const estimatedInputTokens = Math.ceil(planPrompt.length / 4);
  const estimatedOutputTokens = Math.ceil(stdout.length / 4);
  return {
    plan,
    costUsd: (estimatedInputTokens / 1_000_000) * 1.25 + (estimatedOutputTokens / 1_000_000) * 10.0,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  };
}

// ─── Mode A3: Planning via Codex CLI ─────────────────────────

async function planViaCodexCli(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
): Promise<PlanResult> {
  onProgress?.('Generating plan via Codex CLI...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const plannerPrompt = loadPrompt('planner', workspaceDir, {
    projectContext,
    workspaceContext: workspaceContext ?? 'No files yet (empty workspace).',
    userPrompt,
    projectType: projectConfig?.type ?? 'unknown',
  });
  onProgress?.(`Planner prompt: ${plannerPrompt.source}${plannerPrompt.filePath ? ` (${plannerPrompt.filePath})` : ' (built-in)'}`);

  const planPrompt = systemPrompt ? `${systemPrompt}\n\n${plannerPrompt.content}` : plannerPrompt.content;

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const codexPath = await resolveCli('codex');
  if (!codexPath) {
    throw new Error('Codex CLI not found');
  }

  const MAX_CODEX_PROMPT = 50_000;
  const codexPrompt = planPrompt.length > MAX_CODEX_PROMPT
    ? planPrompt.slice(0, MAX_CODEX_PROMPT) + '\n\n[PROMPT TRUNCATED FOR CLI LIMITS]'
    : planPrompt;

  const result = await execa(codexPath, [
    'exec', codexPrompt, '--full-auto', '--json',
  ], {
    cwd: workspaceDir,
    timeout: 120_000,
    reject: false,
    env: { ...process.env },
  });

  if (result.exitCode !== 0) {
    throw new Error(`Codex CLI planning failed (exit ${result.exitCode}): ${result.stderr?.slice(0, 500)}`);
  }

  const parsed = extractJson(result.stdout, 'summary');
  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${result.stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const estimatedInputTokens = Math.ceil(planPrompt.length / 4);
  const estimatedOutputTokens = Math.ceil(result.stdout.length / 4);
  return {
    plan,
    costUsd: (estimatedInputTokens / 1_000_000) * 1.10 + (estimatedOutputTokens / 1_000_000) * 4.40,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  };
}

// ─── Mode B: Manual Planning ──────────────────────────────────

function planFromManualInput(
  codingPrompt: string,
  verificationChecklist: string,
  onProgress?: (msg: string) => void,
): PlanResult {
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
  return { plan, costUsd: 0, inputTokens: 0, outputTokens: 0 };
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
): Promise<PlanResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  onProgress?.('Generating plan via Claude API...');

  const projectContext = projectConfig
    ? `Project: ${projectConfig.displayName} (${projectConfig.language}), build: ${projectConfig.buildCmd ?? 'none'}, dev: ${projectConfig.devCmd}, port: ${projectConfig.defaultPort ?? 'none'}`
    : 'Project type: unknown';

  const plannerPrompt = loadPrompt('planner', undefined, {
    projectContext,
    workspaceContext: workspaceContext ?? 'No files yet (empty workspace).',
    userPrompt,
    projectType: projectConfig?.type ?? 'unknown',
  });
  onProgress?.(`Planner prompt: ${plannerPrompt.source}${plannerPrompt.filePath ? ` (${plannerPrompt.filePath})` : ' (built-in)'}`);

  const systemContent = systemPrompt
    ? `${systemPrompt}\n\nRespond with ONLY the JSON object, no markdown code fences, no explanation.`
    : 'Respond with ONLY the JSON object, no markdown code fences, no explanation.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0.1,
    system: systemContent,
    messages: [
      {
        role: 'user',
        content: plannerPrompt.content,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = extractJson(text, 'summary');
  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;
  return { plan, costUsd, inputTokens, outputTokens };
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
  timeoutMs?: number,
): Promise<PlanResult> {
  switch (mode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    case 'auto' as any:  // backward compat — treat as claude-cli
    case 'claude-cli':
      return planViaCliAgent(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt, timeoutMs);

    case 'gemini-cli':
      return planViaGeminiCli(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt);

    case 'codex-cli':
      return planViaCodexCli(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt);

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
