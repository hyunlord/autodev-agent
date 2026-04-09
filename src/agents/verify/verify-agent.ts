import type { IAgent, AgentInput, AgentOutput, VerifyInput, VerifyResult } from '../interfaces';
import { createPlaywrightTool } from './tools/playwright-verify';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
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
  fallbackLlms: string[] = [];

  constructor(llm?: string) {
    this.llm = llm ?? 'claude-cli';
    this.id = `verify-${this.llm}`;
    this.name = `Verify Agent (${this.llm})`;
  }

  async isAvailable(): Promise<boolean> {
    const cliName = this.llm.replace('-cli', '');
    const resolved = await resolveCli(cliName);
    return resolved !== null;
  }

  /**
   * Coding Agent와 다른 LLM을 자동 선택
   */
  static async selectDifferentFrom(codingAgentId: string): Promise<{ primary: VerifyAgent; fallbacks: string[] }> {
    const candidates = ['codex-cli', 'gemini-cli', 'claude-cli'];
    const codingLlm = codingAgentId.replace('claude-code', 'claude-cli');

    const available: string[] = [];
    for (const candidate of candidates) {
      if (candidate === codingLlm) continue;
      const agent = new VerifyAgent(candidate);
      if (await agent.isAvailable()) {
        available.push(candidate);
      }
    }

    if (available.length === 0) {
      // Last resort: 같은 LLM (자기 합리화 위험 있지만 없는 것보다 나음)
      return { primary: new VerifyAgent('claude-cli'), fallbacks: [] };
    }

    return {
      primary: new VerifyAgent(available[0]),
      fallbacks: available.slice(1),
    };
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

    // ─── Stage 2.8: Acceptance criteria check ──────────
    const plan = (verifyInput as any).plan;
    const ac = plan?.acceptanceCriteria;
    if (ac) {
      emit({ type: 'log', level: 'info', message: '[Verify] Checking acceptance criteria...' } as PipelineEvent);
      const acFails: string[] = [];

      // 필수 파일 체크
      if (ac.requiredFiles) {
        for (const f of ac.requiredFiles as string[]) {
          if (!existsSync(join(verifyInput.projectDir, f))) {
            acFails.push(`Required file missing: ${f}`);
          }
        }
      }

      if (acFails.length > 0) {
        emit({ type: 'log', level: 'warn', message: `[Verify] ${acFails.length} acceptance criteria failed` } as PipelineEvent);
      } else {
        emit({ type: 'log', level: 'info', message: '[Verify] Acceptance criteria: all passed' } as PipelineEvent);
      }
      evidence.acceptanceFails = acFails;
      evidence.hasAcceptanceCriteria = true;
    }

    // ─── Stage 2.9a: SAST scan (optional) ─────────────
    if (ac?.security?.semgrepScan || process.env.AUTODEV_SAST_ENABLED === '1') {
      emit({ type: 'log', level: 'info', message: '[Verify] Running SAST scan...' } as PipelineEvent);
      try {
        const ex = await getExeca();
        const sastResult = await ex('npx', ['semgrep', 'scan', '--config=auto', '--json', '--quiet', verifyInput.projectDir], {
          timeout: 60_000, reject: false,
        } as any);
        if ((sastResult as any).exitCode === 0) {
          const findings = JSON.parse((sastResult as any).stdout ?? '{}').results?.length ?? 0;
          evidence.sastFindings = findings;
          emit({ type: 'log', level: findings > 0 ? 'warn' : 'info',
            message: `[Verify] SAST: ${findings} finding(s)` } as PipelineEvent);
        }
      } catch {
        emit({ type: 'log', level: 'info', message: '[Verify] SAST scan skipped (semgrep not available)' } as PipelineEvent);
      }
    }

    // ─── Stage 2.9b: A11y scan (via MCP browser_evaluate) ──
    if (evidence.screenshotPath) {
      const mcpEvaluate = verifyInput.tools?.find(t => t.name.includes('browser_evaluate'));
      if (mcpEvaluate) {
        try {
          const axeResult = await mcpEvaluate.execute({
            expression: `(async()=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js';document.head.appendChild(s);await new Promise(r=>s.onload=r);const res=await axe.run();return JSON.stringify({violations:res.violations.length,details:res.violations.slice(0,5).map(v=>v.description)})})()`,
          });
          if (axeResult.success && axeResult.output) {
            const parsed = JSON.parse(axeResult.output);
            evidence.a11yViolations = parsed.violations;
            evidence.a11yDetails = parsed.details;
            emit({ type: 'log', level: parsed.violations > 0 ? 'warn' : 'info',
              message: `[Verify] A11y: ${parsed.violations} violation(s)` } as PipelineEvent);
          }
        } catch {
          emit({ type: 'log', level: 'info', message: '[Verify] A11y scan skipped' } as PipelineEvent);
        }
      }
    }

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
            + `\n...[FILE TRUNCATED for prompt size. Full file on disk is ${content.length} bytes. Truncation does NOT mean the code is broken — any @media queries, CSS rules, or code beyond this point are intact on disk. Do NOT report truncation-related issues.]...`;
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
          const navResult = await mcpNavigate.execute({ url: fileUrl });

          // MCP Playwright는 file:// 프로토콜을 차단할 수 있음 — navigate 성공 여부 확인
          if (!navResult.success) {
            throw new Error(`MCP navigate failed: ${(navResult.output ?? '').slice(0, 200)}`);
          }

          // 페이지 로드 대기 — navigate가 즉시 리턴해서 about:blank 상태에서 screenshot 찍히는 문제 방지
          // MCP Playwright browser_wait_for는 { text, textGone, time } 파라미터 지원 (selector는 없음)
          const mcpWaitFor = input.tools?.find(t => t.name.includes('browser_wait_for'));
          if (mcpWaitFor) {
            try {
              await mcpWaitFor.execute({ time: 2 });
            } catch {
              // browser_wait_for 실패 시 setTimeout 폴백
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } else {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }

          const ssResult = await mcpScreenshot.execute({});
          if (ssResult.success) {
            evidence.screenshot = { pageText: ssResult.output };
            emit({ type: 'log', level: 'info', message: '[Verify] MCP Playwright screenshot captured' } as PipelineEvent);

            // 이미지 데이터 보존 — MCP CallToolResult.content[]에서 image 블록 찾기
            // MCP screenshot은 { content: [{ type: 'image', data: '<base64>', mimeType: 'image/png' }], isError: false } 반환
            const ssData = ssResult.data as { content?: Array<{ type: string; data?: string; mimeType?: string }> } | undefined;
            const imageBlock = ssData?.content?.find(c => c.type === 'image' && c.data);
            const imageBase64 = imageBlock?.data;
            const imagePath = undefined as string | undefined;

            if (imageBase64) {
              try {
                const screenshotDir = join(process.env.HOME ?? '/tmp', '.autodev', 'screenshots');
                mkdirSync(screenshotDir, { recursive: true });
                const ssPath = join(screenshotDir, `verify-${Date.now()}.png`);
                writeFileSync(ssPath, Buffer.from(imageBase64, 'base64'));
                evidence.screenshotPath = ssPath;
                emit({ type: 'log', level: 'info', message: `[Verify] Screenshot saved: ${ssPath}` } as PipelineEvent);
              } catch (saveErr) {
                emit({ type: 'log', level: 'info', message: `[Verify] Screenshot save failed: ${saveErr}` } as PipelineEvent);
              }
            } else if (imagePath) {
              evidence.screenshotPath = imagePath;
            }
          }

          // Collect computed CSS styles for design quality assessment
          const mcpEvaluate = input.tools?.find(t => t.name.includes('browser_evaluate'));
          if (mcpEvaluate) {
            try {
              const styleCheckResult = await mcpEvaluate.execute({
                expression: `(() => {
                  const body = document.body;
                  const cs = getComputedStyle(body);
                  const buttons = Array.from(document.querySelectorAll('button'));
                  const firstButton = buttons[0];
                  const btnStyle = firstButton ? getComputedStyle(firstButton) : null;
                  const container = document.querySelector('.container, .card, .counter-card, [class*="card"], [class*="container"], main, .app');
                  const containerStyle = container ? getComputedStyle(container) : null;
                  return JSON.stringify({
                    body: {
                      backgroundColor: cs.backgroundColor,
                      color: cs.color,
                      fontFamily: cs.fontFamily,
                      fontSize: cs.fontSize,
                    },
                    button: btnStyle ? {
                      backgroundColor: btnStyle.backgroundColor,
                      borderRadius: btnStyle.borderRadius,
                      padding: btnStyle.padding,
                      cursor: btnStyle.cursor,
                      border: btnStyle.border,
                      transition: btnStyle.transition,
                    } : null,
                    container: containerStyle ? {
                      backgroundColor: containerStyle.backgroundColor,
                      borderRadius: containerStyle.borderRadius,
                      boxShadow: containerStyle.boxShadow,
                      padding: containerStyle.padding,
                    } : null,
                    meta: {
                      buttonCount: buttons.length,
                      hasCustomFont: !cs.fontFamily.includes('Times New Roman') && !cs.fontFamily.includes('serif'),
                      title: document.title,
                    }
                  });
                })()`,
              });
              if (styleCheckResult.success) {
                try {
                  evidence.computedStyles = JSON.parse(styleCheckResult.output ?? '{}');
                  emit({ type: 'log', level: 'info', message: '[Verify] CSS computed styles collected via Playwright' } as PipelineEvent);
                } catch {
                  emit({ type: 'log', level: 'info', message: '[Verify] CSS style parse failed' } as PipelineEvent);
                }
              }
            } catch (err) {
              emit({ type: 'log', level: 'info', message: `[Verify] CSS style check failed: ${err}` } as PipelineEvent);
            }
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
            // 직접 Playwright는 파일 경로를 반환 — VLM 분석에 사용
            const directData = ssResult.data as Record<string, unknown> | undefined;
            if (directData?.['screenshotPath']) {
              evidence.screenshotPath = directData['screenshotPath'] as string;
            }
            emit({ type: 'log', level: 'info', message: '[Verify] Screenshot captured (direct Playwright)' } as PipelineEvent);
          }
        } catch (err) {
          emit({ type: 'log', level: 'info', message: `[Verify] Playwright not available: ${err}` } as PipelineEvent);
        }
      }
    }

    // ─── Stage 2.5: Visual analysis (VLM) ──────────────
    if (evidence.screenshotPath) {
      // vlm-config.json에서 설정 읽기
      let vlmEnabled = true;
      try {
        const vlmConfigPath = join(process.env.HOME ?? '/tmp', '.autodev', 'vlm-config.json');
        if (existsSync(vlmConfigPath)) {
          const vlmConfig = JSON.parse(readFileSync(vlmConfigPath, 'utf-8'));
          vlmEnabled = vlmConfig.enabled !== false;
          if (vlmConfig.apiKey) {
            if ((vlmConfig.provider === 'openrouter' || !vlmConfig.provider) && !process.env.OPENROUTER_API_KEY) {
              process.env.OPENROUTER_API_KEY = vlmConfig.apiKey;
            }
          }
          if (vlmConfig.model) {
            process.env.AUTODEV_VLM_MODEL = vlmConfig.model;
          }
        }
      } catch { /* config 없으면 기본값 */ }

      if (!vlmEnabled) {
        emit({ type: 'log', level: 'info', message: '[VLM] Disabled in settings' } as PipelineEvent);
      } else {
        emit({ type: 'log', level: 'info', message: '[Verify] Stage 2.5: Visual analysis...' } as PipelineEvent);
        try {
          const imageBuffer = readFileSync(evidence.screenshotPath as string);
          const imageBase64 = imageBuffer.toString('base64');
          const vlmRuns = parseInt(process.env.AUTODEV_VLM_RUNS ?? '1');

          if (vlmRuns > 1) {
            emit({ type: 'log', level: 'info', message: `[VLM] Running ${vlmRuns}x for majority voting` } as PipelineEvent);
            const results = await Promise.all(
              Array.from({ length: vlmRuns }, () => this.analyzeVisual(imageBase64, input.originalPrompt, emit)),
            );
            const avgScore = Math.round(results.reduce((s, r) => s + r.designScore, 0) / results.length);
            evidence.visualAnalysis = {
              ...results[0],
              designScore: avgScore,
              issues: [...new Set(results.flatMap(r => r.issues))],
              strengths: [...new Set(results.flatMap(r => r.strengths))],
            };
          } else {
            evidence.visualAnalysis = await this.analyzeVisual(imageBase64, input.originalPrompt, emit);
          }

          const va = evidence.visualAnalysis as { designScore: number; issues: string[] };
          emit({
            type: 'log', level: 'info',
            message: `[Verify] Visual analysis: score ${va.designScore}/15, ${va.issues.length} visual issue(s)${vlmRuns > 1 ? ` (${vlmRuns}x avg)` : ''}`,
          } as PipelineEvent);
        } catch (err) {
          emit({ type: 'log', level: 'info', message: `[Verify] Visual analysis skipped: ${err}` } as PipelineEvent);
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

    const computedStyles = evidence.computedStyles as Record<string, unknown> | undefined;
    const styleSection = computedStyles
      ? `\n## Computed CSS Styles (from live browser)\n\`\`\`json\n${JSON.stringify(computedStyles, null, 2)}\n\`\`\`

Use these values to assess design quality:
- body.backgroundColor "rgb(255, 255, 255)" or "rgba(0, 0, 0, 0)" = no custom background (likely unstyled)
- button.borderRadius "0px" = no rounded corners (default browser style)
- button.cursor not "pointer" = missing pointer cursor
- button.transition "all 0s" or empty = no hover transitions
- container.boxShadow "none" = no visual depth
- meta.hasCustomFont = false means using default serif font (unprofessional)`
      : '';

    const visualAnalysis = evidence.visualAnalysis as {
      designScore: number; layoutScore: number; colorScore: number;
      interactionScore: number; completenessScore: number;
      issues: string[]; strengths: string[];
    } | undefined;
    const visualSection = visualAnalysis
      ? `\n## Visual Analysis (VLM screenshot review)\nDesign Score: ${visualAnalysis.designScore}/15 (Layout: ${visualAnalysis.layoutScore}/4 | Color: ${visualAnalysis.colorScore}/4 | Interaction: ${visualAnalysis.interactionScore}/4 | Completeness: ${visualAnalysis.completenessScore}/3)\n${visualAnalysis.issues.length > 0 ? `Visual Issues:\n${visualAnalysis.issues.map(i => `- ${i}`).join('\n')}` : 'No visual issues found.'}\n${visualAnalysis.strengths.length > 0 ? `Visual Strengths:\n${visualAnalysis.strengths.map(s => `- ${s}`).join('\n')}` : ''}`
      : '';

    const sastFindings = evidence.sastFindings as number | undefined;
    const sastSection = sastFindings != null
      ? `\n## Security Scan (SAST)\n${sastFindings} finding(s) detected.${sastFindings > 0 ? ' Review security issues before passing.' : ' No issues found.'}`
      : '';

    const a11yViolations = evidence.a11yViolations as number | undefined;
    const a11yDetails = (evidence.a11yDetails ?? []) as string[];
    const a11ySection = a11yViolations != null
      ? `\n## Accessibility (axe-core)\nViolations: ${a11yViolations}${a11yDetails.length > 0 ? '\n' + a11yDetails.map(d => `- ${d}`).join('\n') : ''}`
      : '';

    const acFails = evidence.acceptanceFails as string[] | undefined;
    const acceptanceSection = acFails && acFails.length > 0
      ? `\n## Acceptance Criteria FAILURES\n${acFails.map(f => `- FAIL: ${f}`).join('\n')}\nThese are hard requirements. If any fail, verdict MUST be "re-code" or "fail".`
      : evidence.hasAcceptanceCriteria
        ? '\n## Acceptance Criteria: ALL PASSED'
        : '';

    const verifyFeedback = (input as any).context?.verifyFeedback as
      | { previousVerdict: string; issues: string[]; suggestions: string[]; attemptCount: number }
      | undefined;

    const previousAttemptSection = verifyFeedback
      ? `\n=== PREVIOUS ATTEMPT CONTEXT (attempt ${verifyFeedback.attemptCount - 1} of ${verifyFeedback.attemptCount}) ===
The coding agent was asked to fix these issues from the last verification:
${verifyFeedback.issues.map(i => `- ${i}`).join('\n')}

CRITICAL ANTI-REPETITION RULES:
- You are evaluating the CURRENT state of the files, not a previous version.
- The coding agent has had a chance to fix the above issues. Do NOT assume they still exist.
- Read the actual file contents provided below and verify each issue independently.
- Do NOT copy or repeat previous verification feedback verbatim.
- If an issue was fixed, acknowledge it as resolved — do not report it again.
- Only report issues that you can directly observe in the current file contents.
`
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

**Design Quality Check (for all UI/frontend tasks)**:
When evaluating frontend code, also assess visual quality on a 0-15 point scale:
- **Layout & Spacing (0-4)**: Content is properly centered/aligned? Consistent padding/margins? No overlapping or cramped elements?
- **Color & Typography (0-4)**: Cohesive color scheme (not default browser gray)? Readable font choices? Proper text hierarchy?
- **Interactive Polish (0-4)**: Buttons have hover/active states? Smooth transitions? Cursor changes on interactive elements?
- **Completeness (0-3)**: No unstyled elements? Consistent border-radius? Professional overall appearance?

If the design quality score is below 8/15, add it as an issue with specific suggestions (e.g., "Buttons use default browser styling — add background-color, border-radius, padding, and hover state").
Design quality alone should NOT cause a re-plan, but it CAN cause a re-code with specific visual fix instructions.
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

=== COMMON FALSE POSITIVE WARNING ===
Do NOT report "file path in CSS media query" or "@media keyword replaced by file path" unless you can quote the EXACT offending line from the file contents below.
If the CSS contains a valid @media rule (e.g., @media (max-width: 480px) { ... }), that is CORRECT — not an error.
Responsive CSS is OPTIONAL unless the user explicitly requested it. Do not fail a task for lacking responsive design if it was not mentioned in the requirements.
If you reported this same issue in a previous attempt and cannot find the exact problematic line in the current file contents, treat it as RESOLVED.

${previousAttemptSection}
=== ORIGINAL USER REQUEST ===
${input.originalPrompt}

=== FILES CREATED/MODIFIED ===
${input.modifiedFiles.join(', ')}

=== FILE CONTENTS ===
${fileContentsSection}
${screenshotSection}
${styleSection}
${visualSection}
${acceptanceSection}
${sastSection}
${a11ySection}

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
- 90-100: All features work correctly, good code quality, AND polished visual design (if UI task)
- 80-89: All features work, minor issues OR acceptable but basic visual design
- 70-79: Core features work, some issues, visual design needs improvement
- 50-69: Some features work but significant functional or visual issues
- Below 50: Major features broken or missing

For UI/frontend tasks: A fully functional but visually unstyled result should score no higher than 79.
A result with broken functionality but beautiful design should score based on functionality (design doesn't compensate for broken features).

CRITICAL: Score 80+ ONLY if you have traced through the logic with concrete inputs and verified correctness. Do NOT give high scores based on "the code looks reasonable."`;

    // ─── Debug: dump prompt to file ───────────────────────
    try {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join: _join } = await import('path');
      const debugDir = _join(process.env.HOME ?? '/tmp', '.autodev', 'debug');
      mkdirSync(debugDir, { recursive: true });
      const ts = Date.now();
      writeFileSync(_join(debugDir, `verify-prompt-${ts}.txt`), verifyPrompt, 'utf-8');
      emit({ type: 'log', level: 'info', message: `[Verify] Debug prompt → ~/.autodev/debug/verify-prompt-${ts}.txt` } as PipelineEvent);
    } catch { /* non-critical */ }

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
          ], { cwd: input.projectDir, reject: false, timeout: 120_000, cancelSignal: controller.signal } as any);
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
          ], { cwd: input.projectDir, reject: false, timeout: 120_000, cancelSignal: controller.signal } as any);
          stdout = (result as any).stdout ?? '';
        } finally {
          clearTimeout(timer);
        }
      }

      // ─── Debug: dump response ───────────────────────────
      try {
        const { writeFileSync, mkdirSync } = await import('fs');
        const { join: _join } = await import('path');
        const debugDir = _join(process.env.HOME ?? '/tmp', '.autodev', 'debug');
        mkdirSync(debugDir, { recursive: true });
        const ts = Date.now();
        writeFileSync(_join(debugDir, `verify-response-${ts}.txt`), stdout, 'utf-8');
        emit({ type: 'log', level: 'info', message: `[Verify] Debug response → ~/.autodev/debug/verify-response-${ts}.txt` } as PipelineEvent);
      } catch { /* non-critical */ }

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
      emit({ type: 'log', level: 'warn', message: `[Verify] ${this.llm} LLM judgment failed: ${err}` } as PipelineEvent);

      // Fallback: try next available LLM
      if (this.fallbackLlms && this.fallbackLlms.length > 0) {
        const nextLlm = this.fallbackLlms[0];
        emit({ type: 'log', level: 'info', message: `[Verify] ${this.llm} failed, retrying with ${nextLlm}` } as PipelineEvent);
        const fallbackAgent = new VerifyAgent(nextLlm);
        fallbackAgent.fallbackLlms = this.fallbackLlms.slice(1);
        return fallbackAgent.runLlmJudgment(input, evidence, emit);
      }

      // All LLMs exhausted: fallback score
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

  // ─── VLM: Visual analysis via OpenRouter / Anthropic Vision ───
  private async analyzeVisual(
    imageBase64: string,
    originalPrompt: string,
    emit: (e: PipelineEvent) => void,
  ): Promise<{
    designScore: number;
    layoutScore: number;
    colorScore: number;
    interactionScore: number;
    completenessScore: number;
    issues: string[];
    strengths: string[];
  }> {
    const vlmPrompt = `You are a UI design quality reviewer. The user requested: "${originalPrompt.slice(0, 500)}"

Rate the visual quality of this screenshot on these criteria:
- Layout & Spacing (0-4): Proper alignment, consistent padding/margins, no overlapping or cramped elements
- Color & Typography (0-4): Cohesive color scheme (not default browser gray), readable fonts, text hierarchy
- Interactive Polish (0-4): Buttons look clickable, visual states distinguishable, cursor changes
- Completeness (0-3): No unstyled elements, consistent border-radius, professional overall appearance

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "designScore": <sum of all scores 0-15>,
  "layoutScore": <0-4>,
  "colorScore": <0-4>,
  "interactionScore": <0-4>,
  "completenessScore": <0-3>,
  "issues": ["specific visual issue 1"],
  "strengths": ["specific visual strength 1"]
}`;

    const vlmModel = process.env.AUTODEV_VLM_MODEL ?? 'google/gemini-3.1-flash-lite-preview';
    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterKey) {
      throw new Error('VLM requires OPENROUTER_API_KEY');
    }

    emit({ type: 'log', level: 'info', message: `[VLM] Using OpenRouter (${vlmModel})` } as PipelineEvent);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
      },
      body: JSON.stringify({
        model: vlmModel,
        max_tokens: 1000,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            { type: 'text', text: vlmPrompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter VLM failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  }
}
