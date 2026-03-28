import type { VerificationSpec } from './planning';
import type { ProjectConfig } from '../lib/detection/project-type';
import type { PipelineEvent } from '../lib/types';
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

  try {
    for (const step of spec.steps) {
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
            results.push({
              checkId: step.id,
              type: step.type,
              status: result.passed ? 'pass' : 'fail',
              description: step.description,
              expected: step.expectedText ? `File contains "${step.expectedText}"` : `File exists: ${filePath}`,
              actual: result.actual,
              durationMs: result.durationMs,
            });
            emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            break;
          }

          case 'port_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            if (!webCtx && projectConfig) {
              webCtx = await startWebApp({
                projectDir,
                devCmd: projectConfig.devCmd,
                port,
                screenshotDir,
                installCmd: projectConfig.installCmd ?? undefined,
              });
              emit({ type: 'log', level: 'info', message: `Dev server started on port ${port}` });
            }
            const result = await runPortCheck(port);
            results.push({
              checkId: step.id,
              type: step.type,
              status: result.passed ? 'pass' : 'fail',
              description: step.description,
              expected: `Port ${port} listening`,
              actual: result.actual,
              durationMs: result.durationMs,
            });
            emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
            break;
          }

          case 'http_check': {
            const port = projectConfig?.defaultPort ?? 3000;
            const url = step.url ?? `http://localhost:${port}`;
            if (!webCtx && projectConfig) {
              webCtx = await startWebApp({
                projectDir,
                devCmd: projectConfig.devCmd,
                port,
                screenshotDir,
                installCmd: projectConfig.installCmd ?? undefined,
              });
            }
            const result = await runHttpCheck(url);
            results.push({
              checkId: step.id,
              type: step.type,
              status: result.passed ? 'pass' : 'fail',
              description: step.description,
              expected: 'HTTP 2xx/3xx',
              actual: result.actual,
              durationMs: result.durationMs,
            });
            emit({ type: 'verification_result', checkId: step.id, status: result.passed ? 'pass' : 'fail', detail: result.actual });
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
    }

    if (webCtx) {
      consoleErrors = [...webCtx.consoleErrors];
    }
  } finally {
    if (webCtx) {
      await cleanupWebApp(webCtx);
    }
  }

  const allPassed = results.every(r => r.status === 'pass' || r.status === 'skip');

  return { allPassed, results, consoleErrors };
}
