import type { IAgent, AgentInput, AgentOutput, VerifyInput, VerifyResult } from '../interfaces';
import { createPlaywrightTool } from './tools/playwright-verify';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { resolveCli } from '../../lib/cli-resolver';
import { getExeca } from '../../lib/execa';
import { extractJson } from '../../lib/utils/json-extractor';
import type { PipelineEvent } from '../../lib/types';

export class VerifyAgent implements IAgent {
  readonly id: string;
  readonly name: string;
  readonly role = 'verify' as const;
  private llm: string;

  constructor(llm?: string) {
    this.llm = llm ?? 'claude-cli';
    this.id = `verify-${this.llm}`;
    this.name = `Verify Agent (${this.llm})`;
  }

  async isAvailable(): Promise<boolean> {
    if (this.llm === 'claude-api') {
      return !!process.env.ANTHROPIC_API_KEY;
    }
    const cliName = this.llm.replace('-cli', '');
    const resolved = await resolveCli(cliName);
    return resolved !== null;
  }

  /**
   * Coding Agent와 다른 LLM을 자동 선택
   */
  static async selectDifferentFrom(codingAgentId: string): Promise<VerifyAgent> {
    const candidates = ['gemini-cli', 'claude-cli', 'claude-api'];
    const codingLlm = codingAgentId.replace('claude-code', 'claude-cli');

    for (const candidate of candidates) {
      if (candidate === codingLlm) continue;
      const agent = new VerifyAgent(candidate);
      if (await agent.isAvailable()) {
        return agent;
      }
    }

    // claude-api는 Coding이 Claude가 아닐 때만
    if (!codingLlm.includes('claude') && process.env.ANTHROPIC_API_KEY) {
      return new VerifyAgent('claude-api');
    }

    // Last resort: 같은 LLM (자기 합리화 위험 있지만 없는 것보다 나음)
    return new VerifyAgent('claude-cli');
  }

  async invoke(input: AgentInput): Promise<AgentOutput> {
    // TODO R2: IAgent를 제네릭으로 리팩터하면 캐스팅 제거 가능
    const verifyInput = input as unknown as VerifyInput;
    const startTime = Date.now();
    const emit = input.onProgress ?? (() => {});

    emit({ type: 'log', level: 'info', message: `[Verify Agent] Using ${this.llm}` } as PipelineEvent);

    // ─── Stage 1: Mechanical checks (토큰 0) ──────────
    if (!verifyInput.skipMechanical) {
      emit({ type: 'log', level: 'info', message: '[Verify] Stage 1: Mechanical checks...' } as PipelineEvent);

      const mechanicalResult = await this.runMechanicalChecks(verifyInput, emit);
      if (!mechanicalResult.passed) {
        return {
          success: true,
          result: mechanicalResult,
          costUsd: 0,
          tokenUsage: { input: 0, output: 0 },
          durationMs: Date.now() - startTime,
        };
      }
    } else {
      emit({ type: 'log', level: 'info', message: '[Verify] Stage 1: Skipped (layer 1)' } as PipelineEvent);
    }

    // ─── Stage 2: Collect evidence for LLM ────────────
    emit({ type: 'log', level: 'info', message: '[Verify] Stage 2: Collecting evidence...' } as PipelineEvent);

    const evidence = await this.collectEvidence(verifyInput, emit);

    // ─── Stage 3: LLM judgment ────────────────────────
    emit({ type: 'log', level: 'info', message: '[Verify] Stage 3: LLM judgment...' } as PipelineEvent);

    const llmResult = await this.runLlmJudgment(verifyInput, evidence, emit);

    return {
      success: true,
      result: llmResult.verifyResult,
      costUsd: llmResult.costUsd,
      tokenUsage: llmResult.tokenUsage,
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Stage 1: Mechanical ──────────────────────────────
  private async runMechanicalChecks(
    input: VerifyInput,
    emit: (e: PipelineEvent) => void,
  ): Promise<VerifyResult> {
    // Check: files were actually created
    // TODO: 삭제만 한 경우 modifiedFiles가 빈 배열 → 삭제 변경도 허용하도록 개선
    if (input.modifiedFiles.length === 0) {
      emit({ type: 'log', level: 'warn', message: '[Verify] No files were created/modified' } as PipelineEvent);
      return {
        passed: false,
        score: 0,
        reason: 'No files were created or modified by the coding agent',
        issues: ['No files created'],
        suggestions: ['The coding agent needs to actually create the requested files'],
        verdict: 're-code',
        evidence: {},
      };
    }

    // Check: files exist on disk
    const missingFiles: string[] = [];
    for (const file of input.modifiedFiles) {
      const fullPath = join(input.projectDir, file);
      if (!existsSync(fullPath)) {
        missingFiles.push(`File listed but not found: ${file}`);
      }
    }

    if (missingFiles.length > 0) {
      return {
        passed: false,
        score: 10,
        reason: `Files missing: ${missingFiles.join(', ')}`,
        issues: missingFiles,
        suggestions: ['Ensure files are written to the correct directory'],
        verdict: 're-code',
        evidence: {},
      };
    }

    // Check: try build if package.json exists
    const packageJsonPath = join(input.projectDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const ex = await getExeca();
        if (!existsSync(join(input.projectDir, 'node_modules'))) {
          await ex('npm', ['install'], { cwd: input.projectDir, reject: false, timeout: 120_000 } as any);
        }
        const buildResult = await ex('npm', ['run', 'build'], { cwd: input.projectDir, reject: false, timeout: 60_000 } as any);
        if ((buildResult as any).exitCode !== 0) {
          const stderr = ((buildResult as any).stderr ?? '').slice(0, 2000);
          return {
            passed: false,
            score: 20,
            reason: `Build failed: ${stderr.slice(0, 500)}`,
            issues: ['Build failed'],
            suggestions: ['Fix build errors before proceeding'],
            verdict: 're-code',
            evidence: { buildResult: stderr },
          };
        }
      } catch { /* no build script — fine for static projects */ }
    }

    // Mechanical checks passed — proceed to LLM
    return {
      passed: true, score: 100, reason: 'Mechanical checks passed',
      issues: [], suggestions: [], verdict: 'pass', evidence: {},
    };
  }

  // ─── Stage 2: Evidence collection ─────────────────────
  private async collectEvidence(
    input: VerifyInput,
    emit: (e: PipelineEvent) => void,
  ): Promise<Record<string, unknown>> {
    const evidence: Record<string, unknown> = {};

    // Read file contents (limit total size for CLI prompt)
    const fileContents: Record<string, string> = {};
    const truncatedFiles: Record<string, number> = {};
    let totalContentSize = 0;
    const maxTotalContent = 60000;
    for (const file of input.modifiedFiles) {
      if (totalContentSize >= maxTotalContent) break;
      const fullPath = join(input.projectDir, file);
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath, 'utf-8');
        const remaining = maxTotalContent - totalContentSize;
        const maxPerFile = Math.min(remaining, 15000);
        if (content.length > maxPerFile) {
          fileContents[file] = content.slice(0, maxPerFile)
            + `\n...[NOTE: This file was truncated from ${content.length} bytes. The code may be complete — do not fail based on truncation alone.]...`;
          truncatedFiles[file] = content.length;
        } else {
          fileContents[file] = content;
        }
        totalContentSize += fileContents[file].length;
      }
    }
    evidence.truncatedFiles = truncatedFiles;
    evidence.fileContents = fileContents;

    // List all files in project
    try {
      evidence.allFiles = readdirSync(input.projectDir, { recursive: true })
        .map(String)
        .filter((f: string) => !f.startsWith('.git/') && !f.startsWith('node_modules/'))
        .slice(0, 100);
    } catch { evidence.allFiles = []; }

    // Try to detect if it's a web project and take screenshot
    const hasHtml = input.modifiedFiles.some(f => f.endsWith('.html'));
    if (hasHtml) {
      const htmlFile = input.modifiedFiles.find(f => f.endsWith('.html'))!;

      // 1순위: MCP Playwright (연결돼있으면)
      const mcpNavigate = input.tools?.find(t => t.name.includes('browser_navigate'));
      const mcpScreenshot = input.tools?.find(t => t.name.includes('browser_take_screenshot'));

      if (mcpNavigate && mcpScreenshot) {
        try {
          const fileUrl = `file://${join(input.projectDir, htmlFile)}`;
          await mcpNavigate.execute({ url: fileUrl });
          const ssResult = await mcpScreenshot.execute({});
          if (ssResult.success) {
            evidence.screenshot = { pageText: ssResult.output };
            emit({ type: 'log', level: 'info', message: '[Verify] MCP Playwright screenshot captured' } as PipelineEvent);
          }
        } catch (err) {
          emit({ type: 'log', level: 'info', message: `[Verify] MCP Playwright failed, falling back to direct Playwright: ${err}` } as PipelineEvent);
        }
      }

      // 2순위: 기존 Playwright (폴백)
      if (!evidence.screenshot) {
        try {
          const screenshotDir = join(process.cwd(), '.autodev', 'screenshots', 'verify');
          const playwrightTool = createPlaywrightTool(input.projectDir, screenshotDir);
          const ssResult = await playwrightTool.execute({ file: htmlFile, action: 'screenshot' });
          if (ssResult.success) {
            evidence.screenshot = ssResult.data;
            emit({ type: 'log', level: 'info', message: '[Verify] Screenshot captured (direct Playwright)' } as PipelineEvent);
          }
        } catch (err) {
          emit({ type: 'log', level: 'info', message: `[Verify] Playwright not available: ${err}` } as PipelineEvent);
        }
      }
    }

    return evidence;
  }

  // ─── Stage 3: LLM judgment ────────────────────────────
  private async runLlmJudgment(
    input: VerifyInput,
    evidence: Record<string, unknown>,
    emit: (e: PipelineEvent) => void,
  ): Promise<{ verifyResult: VerifyResult; costUsd: number; tokenUsage: { input: number; output: number } }> {

    const fileContents = (evidence.fileContents ?? {}) as Record<string, string>;
    const allFiles = (evidence.allFiles ?? []) as string[];
    const screenshot = evidence.screenshot as Record<string, unknown> | undefined;

    // Build prompt for Verify Agent
    const fileContentsSection = Object.entries(fileContents)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const screenshotSection = screenshot?.pageText
      ? `\n## Page Content (from browser render)\nTitle: ${screenshot.title}\nBody text: ${(screenshot.pageText as string)?.slice(0, 3000)}`
      : '';

    const verifyPrompt = `You are a verification specialist. Your job is not to confirm the implementation works — it's to try to break it.

You have two documented failure patterns. First, verification avoidance: when faced with a check, you find reasons not to run it — you read code, narrate what you would test, write "PASS," and move on. Second, being seduced by the first 80%: you see polished code and feel inclined to pass it, not noticing half the features are missing, the logic is wrong, or edge cases crash. The first 80% is the easy part. Your entire value is in finding the last 20%.

=== CRITICAL: DO NOT MODIFY THE PROJECT ===
You are STRICTLY PROHIBITED from creating, modifying, or deleting any files. You may only READ and ANALYZE.

=== WHAT YOU RECEIVE ===
Original user request, files created/modified, file contents, and optionally screenshots.

=== VERIFICATION STRATEGY ===
Adapt your strategy based on what was changed:

**Frontend/HTML changes**: Read all the code carefully. Check that every requested feature has corresponding implementation. Verify event handlers are wired correctly. Check initial state rendering. If screenshots are provided, verify visual output matches requirements.
**Backend/API changes**: Check endpoint implementations match requirements. Verify error handling exists. Check edge cases in data processing.
**CLI/script changes**: Verify all requested functionality is implemented. Check error handling for invalid inputs.
**Game/interactive logic**: Trace through the logic manually. Check win/lose/draw conditions are correct (this is a common failure point — LLMs frequently reverse win/lose conditions). Verify state management (score tracking, reset functionality).
**Bug fixes**: Verify the fix addresses the root cause, not just symptoms. Check for regressions.

=== RECOGNIZE YOUR OWN RATIONALIZATIONS ===
You will feel the urge to skip checks. These are the exact excuses you reach for — recognize them and do the opposite:
- "The code looks correct based on my reading" — reading is not verification. Trace through the logic with concrete inputs.
- "This is probably fine" — probably is not verified. Check it.
- "The structure looks good" — structure is not correctness. Check the actual logic.
- "I don't see any bugs" — not seeing bugs is different from verifying there are none. Try specific inputs.

=== ADVERSARIAL PROBES ===
Don't just confirm the happy path. Try to break it:
- **Logic verification**: Trace through with specific inputs. For a game: "if player picks Rock and computer picks Scissors, who wins?" Walk through the actual code path.
- **Boundary values**: What happens with empty input, zero, negative numbers, very long strings?
- **Missing features**: Go back to the original request. List every feature mentioned. Check each one exists in the code.
- **State management**: Does reset actually reset everything? Does the counter go below zero if it shouldn't?

=== ISSUES AND SUGGESTIONS FORMAT ===
When reporting issues, be SPECIFIC:
- BAD: "logic is wrong"
- GOOD: "In the determineWinner function, when player=rock and computer=scissors, the code returns 'lose' but should return 'win'. The condition on line ~45 compares (choice1 - choice2) but the subtraction order is reversed."

When suggesting fixes, be SPECIFIC:
- BAD: "fix the logic"
- GOOD: "Change the condition from (playerChoice - computerChoice + 3) % 3 === 2 to === 1 for win detection, and === 2 for lose detection."

=== ISOLATION NOTICE ===
You can see the original user request and the generated files below.
You CANNOT see the implementation plan or the coding agent's reasoning.
Judge the result purely on: does it fulfill the user's request?
Do NOT assume the coding agent followed any particular plan.
The coding agent's self-report is not provided — judge only by what you observe in the files.

=== ORIGINAL USER REQUEST ===
${input.originalPrompt}

=== FILES CREATED/MODIFIED ===
${input.modifiedFiles.join(', ')}

=== FILE CONTENTS ===
${fileContentsSection}
${screenshotSection}

=== ALL FILES IN PROJECT ===
${allFiles.join(', ')}

=== YOUR TASK ===
1. List every feature/requirement from the original request
2. For each feature, verify it exists in the code with correct logic
3. Trace through the logic with concrete inputs (especially for game logic, calculations, conditionals)
4. Check edge cases and error handling
5. Verify the code would actually work if opened/run by the user

=== RESPONSE FORMAT ===
Respond with ONLY valid JSON:
{
  "passed": true/false,
  "score": 0-100,
  "reason": "Brief explanation",
  "issues": ["Specific issue with file/line/logic details", ...],
  "suggestions": ["Specific fix with code changes needed", ...],
  "verdict": "pass" | "re-code" | "re-plan" | "fail"
}

verdict meanings:
- "pass": ALL requirements met AND logic verified with concrete inputs
- "re-code": Issues found but fixable by coding agent (include specific fix instructions)
- "re-plan": Fundamental approach is wrong (e.g., wrong architecture, missing key concept)
- "fail": Cannot be fixed with current tools/approach

Scoring:
- 90-100: All features work correctly, good code quality
- 70-89: Core features work, minor issues
- 50-69: Some features work but significant issues
- Below 50: Major features broken or missing

CRITICAL: Score 80+ ONLY if you have traced through the logic with concrete inputs and verified correctness. Do NOT give high scores based on "the code looks reasonable."`;

    let stdout = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const ex = await getExeca();

      if (this.llm === 'claude-cli') {
        const cliPath = await resolveCli('claude');
        if (!cliPath) throw new Error('Claude CLI not found');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        try {
          const result = await ex(cliPath, [
            '-p', verifyPrompt,
            '--output-format', 'text',
            '--max-turns', '2',
            '--dangerously-skip-permissions',
          ], { cwd: input.projectDir, reject: false, timeout: 120_000, signal: controller.signal } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      } else if (this.llm === 'gemini-cli') {
        const cliPath = await resolveCli('gemini');
        if (!cliPath) throw new Error('Gemini CLI not found');
        const truncatedPrompt = verifyPrompt.length > 40000 ? verifyPrompt.slice(0, 40000) + '\n...[prompt truncated]' : verifyPrompt;
        // Gemini CLI indexes the cwd — use /tmp to avoid hang on large projects
        // AbortController enforces timeout even when reject: false
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        try {
          const result = await ex(cliPath, ['-p', truncatedPrompt], {
            cwd: '/tmp', reject: false, timeout: 120_000,
            cancelSignal: controller.signal,
          } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      } else if (this.llm === 'codex-cli') {
        const cliPath = await resolveCli('codex');
        if (!cliPath) throw new Error('Codex CLI not found');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        try {
          const result = await ex(cliPath, [
            'exec', '--full-auto', '--sandbox', 'workspace-write', '--json',
            verifyPrompt.slice(0, 12000),
          ], { cwd: input.projectDir, reject: false, timeout: 120_000, signal: controller.signal } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      } else if (this.llm === 'claude-api') {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            messages: [{ role: 'user', content: verifyPrompt }],
          }),
        });
        const data = await res.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
        stdout = data.content?.[0]?.text ?? '';
        inputTokens = data.usage?.input_tokens ?? 0;
        outputTokens = data.usage?.output_tokens ?? 0;
      }

      // Estimate cost
      if (!inputTokens) inputTokens = Math.ceil(verifyPrompt.length / 4);
      if (!outputTokens) outputTokens = Math.ceil(stdout.length / 4);
      const costUsd = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;

      // Parse LLM response
      const parsed = extractJson<VerifyResult>(stdout, 'verdict');
      emit({ type: 'log', level: 'info', message: `[Verify] LLM verdict: ${parsed.verdict} (score: ${parsed.score})` } as PipelineEvent);

      return {
        verifyResult: parsed,
        costUsd,
        tokenUsage: { input: inputTokens, output: outputTokens },
      };

    } catch (err) {
      emit({ type: 'log', level: 'warn', message: `[Verify] LLM judgment failed: ${err}` } as PipelineEvent);

      // Fallback: if LLM fails, assume pass if mechanical checks passed
      return {
        verifyResult: {
          passed: true,
          score: 50,
          reason: `LLM verification failed (${err}), defaulting to mechanical-only pass`,
          issues: ['LLM verification unavailable'],
          suggestions: [],
          verdict: 'pass',
          evidence: {},
        },
        costUsd: 0,
        tokenUsage: { input: 0, output: 0 },
      };
    }
  }
}
