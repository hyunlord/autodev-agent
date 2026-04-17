import { z } from 'zod';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { PlanningMode } from '../lib/types';
import { resolveCli } from '../lib/cli-resolver';
import { loadPrompt } from '../lib/harness/prompt-loader';
import { extractJson } from '../lib/utils/json-extractor';

function getLocaleInstruction(locale?: string): string {
  if (locale === 'ko') {
    return '\n\nIMPORTANT: Write the plan summary, file descriptions, and coding prompt instructions in Korean (한국어). Technical terms and file paths remain in English.';
  }
  return '';
}

/**
 * JSON 출력 형식 강제 접미사.
 * Custom prompt가 JSON 형식 지시를 포함하지 않을 때 자동 추가.
 */
const PLAN_JSON_SUFFIX = `

## OUTPUT FORMAT (MANDATORY)
You MUST respond with ONLY valid JSON. No prose before or after. No markdown fences.
Start your response with { and end with }.
Required fields: "summary", "codingPrompt", "estimatedFiles", "verificationSpec".
Schema:
{
  "summary": "one-line plan description",
  "taskCategory": "frontend|backend|fullstack|fix|refactor|test|docs",
  "codingPrompt": "detailed coding instructions for the implementation agent",
  "estimatedFiles": ["file1.ts", "file2.tsx"],
  "verificationSpec": { "steps": [{ "id": "v1", "type": "build_check|file_check|dom_check|http_check|port_check|vlm_check|desktop_check|cli_output_check", "description": "what to verify" }] }
}`;

/**
 * Planning retry prefix.
 * 1차 응답이 JSON이 아닐 때, 전체 프롬프트 앞에 붙여서 재시도.
 * few-shot 예시 1개 포함으로 모델이 형식을 학습하도록 유도.
 */
const PLAN_RETRY_PREFIX = `⚠️ CRITICAL: Your previous response was NOT valid JSON and caused a parsing failure.
You MUST output ONLY a valid JSON object — starting with { and ending with }.
No markdown code fences. No explanation before or after. No prose.

Example of a valid response (follow this exact shape):
{"summary":"Add counter buttons","taskCategory":"frontend","codingPrompt":"Create index.html with +/- buttons and a display element...","estimatedFiles":["index.html"],"verificationSpec":{"steps":[{"id":"v1","type":"file_check","description":"index.html exists","filePath":"index.html"}]}}

Now respond to the ORIGINAL task below with ONLY JSON in the same schema.
Do NOT repeat these instructions — output ONLY the JSON object.

---

`;

/**
 * Planner 프롬프트 완성도 보장.
 * Custom prompt가 {{userPrompt}} 등 template 변수를 사용하지 않아도
 * 유저 작업, 프로젝트 컨텍스트, JSON 형식 지시가 반드시 포함되도록 보장.
 */
function completePlanPrompt(
  loadedContent: string,
  userPrompt: string,
  projectContext: string,
  workspaceContext: string,
  systemPrompt: string | null | undefined,
  locale?: string,
): string {
  let prompt = loadedContent;

  // 유저 작업이 prompt에 포함됐는지 확인 (template 치환 또는 직접 포함)
  const taskSnippet = userPrompt.slice(0, Math.min(40, userPrompt.length));
  if (!prompt.includes(taskSnippet)) {
    prompt += `\n\n## Task\n${userPrompt}`;
  }

  // 프로젝트 컨텍스트 확인
  if (projectContext && !prompt.includes(projectContext.slice(0, 20))) {
    prompt += `\n\n## Project Info\n${projectContext}`;
  }

  // 워크스페이스 컨텍스트 확인
  if (workspaceContext && !prompt.includes(workspaceContext.slice(0, 15))) {
    prompt += `\n\n## Current Workspace\n${workspaceContext}`;
  }

  // JSON 출력 형식 지시 확인
  if (!/respond with .*json/i.test(prompt) && !/OUTPUT FORMAT/i.test(prompt)) {
    prompt += PLAN_JSON_SUFFIX;
  }

  // System prompt 적용
  if (systemPrompt) {
    prompt = `${systemPrompt}\n\n${prompt}`;
  }

  // Locale 지시 적용
  prompt += getLocaleInstruction(locale);

  return prompt;
}

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
  locale?: string,
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

  const planPrompt = completePlanPrompt(
    plannerPrompt.content, userPrompt, projectContext,
    workspaceContext ?? 'No files yet (empty workspace).',
    systemPrompt, locale,
  );

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

  let stdout = result.stdout;
  let retryOccurred = false;
  let parsed: any;
  try {
    parsed = extractJson(stdout, 'summary');
  } catch (firstError) {
    retryOccurred = true;
    onProgress?.(`[Claude] JSON extraction failed (${stdout.length} chars), retrying with full context + JSON emphasis...`);
    const retryPrompt = PLAN_RETRY_PREFIX + planPrompt;

    const retryResult = await execa(claudePath, [
      '--output-format', 'text',
      '--max-turns', '5',
      '--dangerously-skip-permissions',
    ], {
      cwd: workspaceDir,
      timeout: effectiveTimeout,
      reject: false,
      input: retryPrompt,
      env: { ...process.env },
    });

    if (retryResult.exitCode !== 0) {
      throw firstError; // retry도 실패 → 원래 에러 throw
    }
    stdout = retryResult.stdout;
    parsed = extractJson(stdout, 'summary');
  }

  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const firstInputChars = planPrompt.length;
  const retryInputChars = retryOccurred ? PLAN_RETRY_PREFIX.length + planPrompt.length : 0;
  const estimatedInputTokens = Math.ceil((firstInputChars + retryInputChars) / 4);
  const estimatedOutputTokens = Math.ceil(stdout.length / 4);
  return {
    plan,
    costUsd: (estimatedInputTokens / 1_000_000) * 3.0 + (estimatedOutputTokens / 1_000_000) * 15.0,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  };
}

// ─── Gemini CLI helpers ──────────────────────────────────────

async function runGeminiCli(
  execa: Awaited<ReturnType<typeof import('../lib/execa').getExeca>>,
  geminiPath: string,
  prompt: string,
  workspaceDir?: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const result = await execa(geminiPath, [
    '--output-format', 'json',
    '-y',
  ], {
    cwd: workspaceDir,
    timeout: 120_000,
    reject: false,
    input: prompt,
    env: { ...process.env },
  });

  if (result.exitCode !== 0) {
    throw new Error(`Gemini CLI planning failed (exit ${result.exitCode}): ${result.stderr?.slice(0, 500)}`);
  }

  return result.stdout;
}

function unwrapGeminiEnvelope(stdout: string): string {
  try {
    const envelope = JSON.parse(stdout);
    return (envelope.response ?? envelope.result ?? envelope.text ?? stdout) as string;
  } catch {
    return stdout;
  }
}

// ─── Mode A2: Planning via Gemini CLI ────────────────────────

async function planViaGeminiCli(
  userPrompt: string,
  projectConfig: ProjectConfig | null,
  onProgress?: (msg: string) => void,
  workspaceContext?: string,
  workspaceDir?: string,
  systemPrompt?: string | null,
  locale?: string,
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

  const planPrompt = completePlanPrompt(
    plannerPrompt.content, userPrompt, projectContext,
    workspaceContext ?? 'No files yet (empty workspace).',
    systemPrompt, locale,
  );

  const { getExeca } = await import('../lib/execa');
  const execa = await getExeca();
  const geminiPath = await resolveCli('gemini');
  if (!geminiPath) {
    throw new Error('Gemini CLI not found. Install with: npm install -g @google/generative-ai or equivalent');
  }

  // 1차 시도
  let stdout = await runGeminiCli(execa, geminiPath, planPrompt, workspaceDir, onProgress);
  let retryOccurred = false;

  // JSON 파싱 시도 — 실패 시 짧은 JSON 강제 프롬프트로 1회 재시도
  let parsed: any;
  try {
    stdout = unwrapGeminiEnvelope(stdout);
    parsed = extractJson(stdout, 'summary');
  } catch (firstError) {
    retryOccurred = true;
    onProgress?.(`[Gemini] JSON extraction failed (${stdout.length} chars), retrying with full context + JSON emphasis...`);
    const retryPrompt = PLAN_RETRY_PREFIX + planPrompt;

    stdout = await runGeminiCli(execa, geminiPath, retryPrompt, workspaceDir, onProgress);
    stdout = unwrapGeminiEnvelope(stdout);
    parsed = extractJson(stdout, 'summary');
  }

  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const firstInputChars = planPrompt.length;
  const retryInputChars = retryOccurred ? PLAN_RETRY_PREFIX.length + planPrompt.length : 0;
  const estimatedInputTokens = Math.ceil((firstInputChars + retryInputChars) / 4);
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
  locale?: string,
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

  const planPrompt = completePlanPrompt(
    plannerPrompt.content, userPrompt, projectContext,
    workspaceContext ?? 'No files yet (empty workspace).',
    systemPrompt, locale,
  );

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

  let stdout = result.stdout;
  let retryOccurred = false;
  let retryCodexPromptLength = 0;
  let parsed: any;
  try {
    parsed = extractJson(stdout, 'summary');
  } catch (firstError) {
    retryOccurred = true;
    onProgress?.(`[Codex] JSON extraction failed (${stdout.length} chars), retrying with full context + JSON emphasis...`);
    const retryFullPrompt = PLAN_RETRY_PREFIX + planPrompt;
    const retryCodexPrompt = retryFullPrompt.length > MAX_CODEX_PROMPT
      ? retryFullPrompt.slice(0, MAX_CODEX_PROMPT) + '\n\n[PROMPT TRUNCATED FOR CLI LIMITS]'
      : retryFullPrompt;
    retryCodexPromptLength = retryCodexPrompt.length;

    const retryResult = await execa(codexPath, [
      'exec', retryCodexPrompt, '--full-auto', '--json',
    ], {
      cwd: workspaceDir,
      timeout: 120_000,
      reject: false,
      env: { ...process.env },
    });

    if (retryResult.exitCode !== 0) {
      throw firstError;
    }
    stdout = retryResult.stdout;
    parsed = extractJson(stdout, 'summary');
  }

  const plan = PlanSchema.parse(parsed);
  onProgress?.(`Planning output: ${stdout.length} chars, parsed successfully`);
  onProgress?.(`Plan ready: ${plan.summary}`);
  const firstInputChars = codexPrompt.length;
  const retryInputChars = retryOccurred ? retryCodexPromptLength : 0;
  const estimatedInputTokens = Math.ceil((firstInputChars + retryInputChars) / 4);
  const estimatedOutputTokens = Math.ceil(stdout.length / 4);
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
  locale?: string,
): Promise<PlanResult> {
  switch (mode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    case 'auto' as any:  // backward compat — treat as claude-cli
    case 'claude-cli':
      return planViaCliAgent(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt, timeoutMs, locale);

    case 'gemini-cli':
      return planViaGeminiCli(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt, locale);

    case 'codex-cli':
      return planViaCodexCli(userPrompt, projectConfig, onProgress, workspaceContext, workspaceDir, systemPrompt, locale);

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
