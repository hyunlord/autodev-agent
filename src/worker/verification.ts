import type { VerificationSpec } from './planning';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { PipelineEvent } from '../lib/types';
import { loadPrompt } from '../lib/harness/prompt-loader';
import { runBuildCheck } from '../lib/plugins/verifiers/build-check';
import { runFileCheck } from '../lib/plugins/verifiers/file-check';
import { runPortCheck } from '../lib/plugins/verifiers/port-check';
import { runHttpCheck } from '../lib/plugins/verifiers/http-check';
import {
  startWebApp,
  navigateAndScreenshot,
  runDomCheck,
  cleanupWebApp,
  type WebVerifyContext,
} from '../lib/plugins/verifiers/web-playwright';
import { verifyScreenshotViaCli } from '../lib/plugins/vlm/cli-vlm';
import { captureDesktopApp } from '../lib/plugins/verifiers/desktop-screenshot';
import { runCliOutputCheck } from '../lib/plugins/verifiers/cli-output';
import { organizeIntoGates, getSortedTiers, getTierName, tierPassed } from './pipeline-progressive-gates';
import { findBaseline, captureBaseline, compareScreenshots } from '../lib/plugins/verifiers/visual-regression';

export interface VerificationResult {
  allPassed: boolean;
  results: Array<{
    checkId: string;
    type: string;
    status: 'pass' | 'fail' | 'skip';
    description: string;
    expected?: string;
    actual?: string;
    screenshotPath?: string;
    vlmFeedback?: string;
    vlmConfidence?: number;
    durationMs: number;
  }>;
  consoleErrors: string[];
}

type EmitFn = (event: PipelineEvent) => void;

export async function runVerification(
  spec: VerificationSpec,
  projectDir: string,
  projectConfig: ProjectConfig | null,
  screenshotDir: string,
  emit: EmitFn,
): Promise<VerificationResult> {
  const results: VerificationResult['results'] = [];
  let consoleErrors: string[] = [];
  let webCtx: WebVerifyContext | null = null;

  // Load verifier and evaluator prompts from harness
  const verifierPrompt = loadPrompt('verifier', projectDir);
  const evaluatorPrompt = loadPrompt('evaluator', projectDir);
  // evaluatorPrompt reserved for future LLM-based evaluation
  void evaluatorPrompt;

  emit({ type: 'log', level: 'info', message: `Verifier prompt: ${verifierPrompt.source}${verifierPrompt.filePath ? ` (${verifierPrompt.filePath})` : ' (built-in)'}` });

  // ─── I2: Progressive Gates — organize steps by tier ─────────
  const gates = organizeIntoGates(spec.steps);
  const sortedTiers = getSortedTiers(gates);
  if (sortedTiers.length > 1) {
    emit({ type: 'log', level: 'info',
      message: `[Verify] Progressive gates: ${sortedTiers.map(t => `T${t}(${getTierName(t)})`).join(' → ')}` });
  }

  try {
    for (const tier of sortedTiers) {
      const tierSteps = gates.get(tier) ?? [];
      if (sortedTiers.length > 1) {
        emit({ type: 'log', level: 'info', message: `[Verify] ── Gate ${tier}: ${getTierName(tier)} (${tierSteps.length} checks) ──` });
      }

    for (const step of tierSteps) {
      emit({ type: 'log', level: 'info', message: `[Verify] Running: ${step.description}` });
      const startTime = Date.now();

      try {
        switch (step.type) {
          case 'build_check': {
            const cmd = step.command ?? projectConfig?.buildCmd ?? 'npm run build';
            const result = await runBuildCheck(cmd, projectDir);
            const entry = {
              checkId: step.id,
              type: step.type,
              status: result.passed ? 'pass' as const : 'fail' as const,
              description: step.description,
              expected: 'Exit code 0',
              actual: result.passed ? 'Build succeeded' : `Build failed:\n${result.stderr.slice(0, 500)}`,
              durationMs: result.durationMs,
            };
            results.push(entry);
            emit({ type: 'verification_result', checkId: step.id, status: entry.status, detail: entry.actual! });
            if (!result.passed) {
              emit({ type: 'log', level: 'error', message: `Build failed: ${result.stderr.slice(0, 200)}` });
            }
            break;
          }

          case 'file_check': {
            const filePath = step.filePath ?? '';
            const result = runFileCheck(filePath, projectDir, step.expectedText);

            // Enhanced: 파일이 비어있지 않은지도 확인
            if (result.passed && result.actual) {
              const fileSize = result.actual.length;
              if (fileSize < 10) {
                results.push({
                  checkId: step.id,
                  type: step.type,
                  status: 'fail',
                  description: step.description,
                  expected: step.expectedText,
                  actual: `File exists but nearly empty (${fileSize} bytes)`,
                  durationMs: Date.now() - startTime,
                });
                emit({ type: 'log', level: 'warn', message: `[✗] ${step.description}: File nearly empty` });
                emit({ type: 'verification_result', checkId: step.id, status: 'fail', detail: `File nearly empty (${fileSize} bytes)` });
                break;
              }
            }

            results.push({
              checkId: step.id,
              type: step.type,
              status: result.passed ? 'pass' : 'fail',
              description: step.description,
              expected: step.expectedText ? `File contains "${step.expectedText}"` : `File exists: ${filePath}`,
              actual: result.actual,
              durationMs: result.durationMs,
            });
            const icon = result.passed ? '✓' : '✗';
            emit({ type: 'log', level: result.passed ? 'info' : 'warn', message: `[${icon}] ${result.passed ? 'Content found' : result.actual ?? 'Check failed'}` });
            emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            break;
          }

          case 'port_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            if (!webCtx && projectConfig && projectConfig.devCmd) {
              try {
                webCtx = await startWebApp({
                  projectDir,
                  devCmd: projectConfig.devCmd,
                  port,
                  screenshotDir,
                  installCmd: projectConfig.installCmd ?? undefined,
                });
                emit({ type: 'log', level: 'info', message: `Dev server started on port ${port}` });
              } catch (e) {
                results.push({
                  checkId: step.id, type: step.type, status: 'skip',
                  description: step.description,
                  actual: `Could not start dev server: ${e instanceof Error ? e.message : String(e)}`,
                  durationMs: Date.now() - startTime,
                });
                emit({ type: 'verification_result', checkId: step.id, status: 'skip', detail: 'Dev server failed to start' });
                break;
              }
            }
            if (webCtx) {
              const result = await runPortCheck(port);
              results.push({
                checkId: step.id, type: step.type,
                status: result.passed ? 'pass' : 'fail',
                description: step.description,
                expected: `Port ${port} listening`,
                actual: result.actual,
                durationMs: result.durationMs,
              });
              emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            } else {
              results.push({
                checkId: step.id, type: step.type, status: 'skip',
                description: step.description,
                actual: 'Skipped: no dev server configured for this project type',
                durationMs: Date.now() - startTime,
              });
              emit({ type: 'verification_result', checkId: step.id, status: 'skip', detail: 'No dev server to check' });
            }
            break;
          }

          case 'http_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            const url = step.url ?? `http://localhost:${port}`;
            if (!webCtx && projectConfig && projectConfig.devCmd) {
              try {
                webCtx = await startWebApp({
                  projectDir,
                  devCmd: projectConfig.devCmd,
                  port,
                  screenshotDir,
                  installCmd: projectConfig.installCmd ?? undefined,
                });
              } catch {
                results.push({
                  checkId: step.id, type: step.type, status: 'skip',
                  description: step.description,
                  actual: 'Skipped: could not start dev server',
                  durationMs: Date.now() - startTime,
                });
                emit({ type: 'verification_result', checkId: step.id, status: 'skip', detail: 'Dev server failed to start' });
                break;
              }
            }
            if (webCtx) {
              const result = await runHttpCheck(url);
              results.push({
                checkId: step.id, type: step.type,
                status: result.passed ? 'pass' : 'fail',
                description: step.description,
                expected: 'HTTP 2xx/3xx',
                actual: result.actual,
                durationMs: result.durationMs,
              });
              emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            } else {
              results.push({
                checkId: step.id, type: step.type, status: 'skip',
                description: step.description,
                actual: 'Skipped: no dev server running',
                durationMs: Date.now() - startTime,
              });
              emit({ type: 'verification_result', checkId: step.id, status: 'skip', detail: 'No dev server to check' });
            }
            break;
          }

          case 'dom_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            if (!webCtx && projectConfig) {
              webCtx = await startWebApp({
                projectDir,
                devCmd: projectConfig.devCmd,
                port,
                screenshotDir,
                installCmd: projectConfig.installCmd ?? undefined,
              });
              await webCtx.page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle', timeout: 30_000 });
            }
            if (webCtx) {
              const result = await runDomCheck(webCtx, step.selector, step.expectedText);
              const screenshotResult = await navigateAndScreenshot(webCtx, '/', `dom-${step.id}`);
              results.push({
                checkId: step.id,
                type: step.type,
                status: result.passed ? 'pass' : 'fail',
                description: step.description,
                expected: step.selector ? `Selector "${step.selector}" exists` : `Page contains "${step.expectedText}"`,
                actual: result.actual,
                screenshotPath: screenshotResult.screenshotPath,
                durationMs: Date.now() - startTime,
              });
              emit({ type: 'screenshot', path: screenshotResult.screenshotPath, checkId: step.id });
              emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            } else {
              results.push({
                checkId: step.id,
                type: step.type,
                status: 'skip',
                description: step.description,
                actual: 'Skipped: no web context (project type not detected or not a web app)',
                durationMs: Date.now() - startTime,
              });
            }
            break;
          }

          case 'vlm_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            let screenshotPath: string | undefined;

            if (webCtx) {
              const ss = await navigateAndScreenshot(webCtx, '/', `vlm-${step.id}`);
              screenshotPath = ss.screenshotPath;
            } else if (projectConfig && projectConfig.defaultPort) {
              try {
                webCtx = await startWebApp({
                  projectDir,
                  devCmd: projectConfig.devCmd,
                  port,
                  screenshotDir,
                  installCmd: projectConfig.installCmd ?? undefined,
                });
                await webCtx.page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle', timeout: 30_000 });
                const ss = await navigateAndScreenshot(webCtx, '/', `vlm-${step.id}`);
                screenshotPath = ss.screenshotPath;
              } catch (e) {
                results.push({
                  checkId: step.id,
                  type: step.type,
                  status: 'skip',
                  description: step.description,
                  actual: `Cannot take screenshot: ${e instanceof Error ? e.message : String(e)}`,
                  durationMs: Date.now() - startTime,
                });
                emit({ type: 'log', level: 'warn', message: `[Verify] Skipped ${step.id}: screenshot capture failed` });
                continue;
              }
            }

            if (screenshotPath && step.vlmPrompt) {
              emit({ type: 'screenshot', path: screenshotPath, checkId: step.id });
              emit({ type: 'log', level: 'info', message: `[VLM] Analyzing screenshot: ${step.vlmPrompt}` });

              const vlmResult = await verifyScreenshotViaCli(screenshotPath, step.vlmPrompt);

              results.push({
                checkId: step.id,
                type: step.type,
                status: vlmResult.pass ? 'pass' : 'fail',
                description: step.description,
                expected: step.vlmPrompt,
                actual: vlmResult.reasoning,
                screenshotPath,
                vlmFeedback: vlmResult.reasoning,
                vlmConfidence: vlmResult.confidence,
                durationMs: Date.now() - startTime,
              });
              emit({ type: 'verification_result', checkId: step.id, status: vlmResult.pass ? 'pass' : 'fail', detail: vlmResult.reasoning });
            } else {
              results.push({
                checkId: step.id,
                type: step.type,
                status: 'skip',
                description: step.description,
                actual: 'Skipped: no screenshot available or no VLM prompt',
                durationMs: Date.now() - startTime,
              });
            }
            break;
          }

          case 'desktop_check': {
            const runCmd = step.runCmd ?? projectConfig?.devCmd ?? '';
            if (!runCmd) {
              results.push({ checkId: step.id, type: step.type, status: 'skip', description: step.description, actual: 'Skipped: no run command specified', durationMs: Date.now() - startTime });
              break;
            }
            emit({ type: 'log', level: 'info', message: `[Verify] Launching desktop app: ${runCmd}` });
            const desktopResult = await captureDesktopApp({ projectDir, runCmd, screenshotDir, waitMs: step.waitMs ?? 5000, timeoutMs: 30_000 });
            if (desktopResult.error) {
              results.push({ checkId: step.id, type: step.type, status: 'fail', description: step.description, actual: desktopResult.error, durationMs: Date.now() - startTime });
              emit({ type: 'verification_result', checkId: step.id, status: 'fail', detail: desktopResult.error });
              break;
            }
            if (desktopResult.screenshotPath && step.vlmPrompt) {
              emit({ type: 'screenshot', path: desktopResult.screenshotPath, checkId: step.id });
              const vlmResult = await verifyScreenshotViaCli(desktopResult.screenshotPath, step.vlmPrompt);
              results.push({ checkId: step.id, type: step.type, status: vlmResult.pass ? 'pass' : 'fail', description: step.description, expected: step.vlmPrompt, actual: vlmResult.reasoning, screenshotPath: desktopResult.screenshotPath, vlmFeedback: vlmResult.reasoning, vlmConfidence: vlmResult.confidence, durationMs: Date.now() - startTime });
              emit({ type: 'verification_result', checkId: step.id, status: vlmResult.pass ? 'pass' : 'fail', detail: vlmResult.reasoning });
            } else if (desktopResult.screenshotPath) {
              emit({ type: 'screenshot', path: desktopResult.screenshotPath, checkId: step.id });
              results.push({ checkId: step.id, type: step.type, status: 'pass', description: step.description, actual: `App launched and screenshot captured. Exit code: ${desktopResult.processExitCode}`, screenshotPath: desktopResult.screenshotPath, durationMs: Date.now() - startTime });
              emit({ type: 'verification_result', checkId: step.id, status: 'pass', detail: 'Screenshot captured' });
            } else {
              results.push({ checkId: step.id, type: step.type, status: desktopResult.processExitCode === 0 ? 'pass' : 'fail', description: step.description, actual: `App ran (exit ${desktopResult.processExitCode}), screenshot unavailable`, durationMs: Date.now() - startTime });
              emit({ type: 'verification_result', checkId: step.id, status: desktopResult.processExitCode === 0 ? 'pass' : 'fail', detail: `Exit code: ${desktopResult.processExitCode}` });
            }
            break;
          }

          case 'cli_output_check': {
            const command = step.command ?? step.runCmd ?? '';
            if (!command) {
              results.push({ checkId: step.id, type: step.type, status: 'skip', description: step.description, actual: 'Skipped: no command specified', durationMs: Date.now() - startTime });
              break;
            }
            const cliResult = await runCliOutputCheck({ command, cwd: projectDir, expectedExitCode: step.expectedExitCode, expectedStdout: step.expectedStdout ?? step.expectedText, notExpectedStdout: step.notExpectedStdout });
            results.push({
              checkId: step.id, type: step.type, status: cliResult.passed ? 'pass' : 'fail', description: step.description,
              expected: [step.expectedExitCode !== undefined ? `exit ${step.expectedExitCode}` : 'exit 0', step.expectedStdout ? `stdout contains "${step.expectedStdout}"` : null, step.notExpectedStdout ? `stdout not contains "${step.notExpectedStdout}"` : null].filter(Boolean).join(', '),
              actual: cliResult.actual, durationMs: cliResult.durationMs,
            });
            emit({ type: 'verification_result', checkId: step.id, status: cliResult.passed ? 'pass' : 'fail', detail: cliResult.actual });
            break;
          }

          case 'visual_regression': {
            // I5: Visual regression check
            const port = projectConfig?.defaultPort ?? 3000;
            if (!webCtx && projectConfig && projectConfig.devCmd) {
              try {
                webCtx = await startWebApp({
                  projectDir, devCmd: projectConfig.devCmd, port, screenshotDir,
                  installCmd: projectConfig.installCmd ?? undefined,
                });
              } catch { /* skip if dev server fails */ }
            }
            if (webCtx) {
              const route = step.url ?? '/';
              const ssName = `vr-${step.id}`;
              const ss = await navigateAndScreenshot(webCtx, route, ssName);
              const baseline = findBaseline(screenshotDir, ssName);

              if (baseline) {
                const vrResult = await compareScreenshots(baseline, ss.screenshotPath, screenshotDir, step.threshold ?? 0.05);
                results.push({
                  checkId: step.id, type: step.type,
                  status: vrResult.passed ? 'pass' : 'fail',
                  description: step.description,
                  expected: `Visual diff ≤ ${((step.threshold ?? 0.05) * 100).toFixed(0)}%`,
                  actual: vrResult.description,
                  screenshotPath: vrResult.diffPath ?? ss.screenshotPath,
                  durationMs: vrResult.durationMs,
                });
                emit({ type: 'verification_result', checkId: step.id, status: vrResult.passed ? 'pass' : 'fail', detail: vrResult.description });
              } else {
                // No baseline — save current as baseline, pass
                captureBaseline(screenshotDir, ss.screenshotPath, ssName);
                results.push({
                  checkId: step.id, type: step.type, status: 'pass',
                  description: step.description,
                  actual: 'Baseline captured (first run)',
                  screenshotPath: ss.screenshotPath,
                  durationMs: Date.now() - startTime,
                });
                emit({ type: 'verification_result', checkId: step.id, status: 'pass', detail: 'Baseline captured' });
              }
            } else {
              results.push({
                checkId: step.id, type: step.type, status: 'skip',
                description: step.description,
                actual: 'Skipped: no web context for visual regression',
                durationMs: Date.now() - startTime,
              });
              emit({ type: 'verification_result', checkId: step.id, status: 'skip', detail: 'No web context' });
            }
            break;
          }

          default: {
            results.push({
              checkId: step.id,
              type: step.type,
              status: 'skip',
              description: step.description,
              actual: `Unknown check type: ${step.type}`,
              durationMs: Date.now() - startTime,
            });
          }
        }
      } catch (stepError) {
        results.push({
          checkId: step.id,
          type: step.type,
          status: 'fail',
          description: step.description,
          actual: `Error: ${stepError instanceof Error ? stepError.message : String(stepError)}`,
          durationMs: Date.now() - startTime,
        });
        emit({ type: 'verification_result', checkId: step.id, status: 'fail', detail: `Error: ${stepError instanceof Error ? stepError.message : String(stepError)}` });
      }
    } // end step loop

    // I2: Progressive gate — if this tier has failures, skip remaining tiers
    if (sortedTiers.length > 1) {
      const tierResults = results.filter(r =>
        tierSteps.some(s => s.id === r.checkId),
      );
      if (!tierPassed(tierResults)) {
        const failCount = tierResults.filter(r => r.status === 'fail').length;
        emit({ type: 'log', level: 'warn',
          message: `[Verify] Gate ${tier} (${getTierName(tier)}) failed (${failCount} checks). Skipping higher tiers.` });
        // Mark remaining tiers as skipped
        for (const remainingTier of sortedTiers.filter(t => t > tier)) {
          for (const s of gates.get(remainingTier) ?? []) {
            results.push({
              checkId: s.id, type: s.type, status: 'skip',
              description: s.description,
              actual: `Skipped: Gate ${tier} (${getTierName(tier)}) failed`,
              durationMs: 0,
            });
          }
        }
        break; // exit tier loop
      }
      emit({ type: 'log', level: 'info', message: `[Verify] Gate ${tier} passed ✓` });
    }
    } // end tier loop

    if (webCtx) {
      consoleErrors = [...webCtx.consoleErrors];
    }
  } finally {
    if (webCtx) {
      const port = webCtx.port;
      emit({ type: 'log', level: 'info', message: '[Verify] Cleaning up web app...' });
      await cleanupWebApp(webCtx);
      // Force kill any remaining process on the port
      try {
        const { getExeca } = await import('../lib/execa');
        const execa = await getExeca();
        await execa('sh', ['-c', `lsof -ti:${port} | xargs kill -9 2>/dev/null`], {
          reject: false,
          timeout: 5_000,
        });
      } catch { /* no lingering process */ }
      emit({ type: 'log', level: 'info', message: '[Verify] Web app cleaned up, port released' });
    }
  }

  const allPassed = results.every(r => r.status === 'pass' || r.status === 'skip');

  // Summary
  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const skipCount = results.filter(r => r.status === 'skip').length;

  emit({
    type: 'log',
    level: allPassed ? 'info' : 'warn',
    message: `Verification summary: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`,
  });

  // If failed, emit detailed failure analysis
  if (failCount > 0) {
    const failedChecks = results.filter(r => r.status === 'fail');
    const failDetails = failedChecks.map(f =>
      `- ${f.description}: ${f.actual ?? 'unknown reason'}`
    ).join('\n');
    emit({
      type: 'log',
      level: 'warn',
      message: `Verification failed:\n${failDetails}`,
    });
  }

  return { allPassed, results, consoleErrors };
}
