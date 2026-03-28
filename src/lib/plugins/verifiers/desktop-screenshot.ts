import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { nanoid } from 'nanoid';

async function getExeca() {
  return (await import('execa')).execa;
}

export interface DesktopVerifyOptions {
  projectDir: string;
  runCmd: string;
  screenshotDir: string;
  waitMs?: number;
  timeoutMs?: number;
}

export interface DesktopScreenshotResult {
  screenshotPath: string | null;
  processExitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function captureDesktopApp(opts: DesktopVerifyOptions): Promise<DesktopScreenshotResult> {
  const execa = await getExeca();

  if (!existsSync(opts.screenshotDir)) {
    mkdirSync(opts.screenshotDir, { recursive: true });
  }

  const screenshotPath = join(opts.screenshotDir, `desktop-${nanoid(6)}.png`);
  const waitMs = opts.waitMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const isLinux = process.platform === 'linux';

  let appProcess: any;
  let displayEnv = { ...process.env };

  try {
    if (isLinux) {
      const xvfbCheck = await execa('which', ['Xvfb'], { reject: false });
      if (xvfbCheck.exitCode === 0) {
        const xvfb = execa('Xvfb', [':99', '-screen', '0', '1280x720x24'], { reject: false });
        await sleep(1000);
        displayEnv = { ...process.env, DISPLAY: ':99' };

        appProcess = execa('sh', ['-c', opts.runCmd], {
          cwd: opts.projectDir, reject: false, timeout: timeoutMs, env: displayEnv,
        });

        await sleep(waitMs);

        const importCheck = await execa('which', ['import'], { reject: false, env: displayEnv });
        if (importCheck.exitCode === 0) {
          await execa('import', ['-window', 'root', '-display', ':99', screenshotPath], {
            reject: false, timeout: 10000, env: displayEnv,
          });
        } else {
          const scrotCheck = await execa('which', ['scrot'], { reject: false });
          if (scrotCheck.exitCode === 0) {
            await execa('scrot', [screenshotPath], { reject: false, timeout: 10000, env: displayEnv });
          }
        }

        try { appProcess.kill('SIGTERM'); } catch {}
        try { xvfb.kill('SIGTERM'); } catch {}

        const result = await appProcess;
        return {
          screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
          processExitCode: result.exitCode ?? null,
          stdout: result.stdout?.slice(-2000) ?? '',
          stderr: result.stderr?.slice(-2000) ?? '',
        };
      }
    }

    appProcess = execa('sh', ['-c', opts.runCmd], {
      cwd: opts.projectDir, reject: false, timeout: timeoutMs, env: displayEnv,
    });

    await sleep(waitMs);

    try {
      const screenshotDesktop = (await import('screenshot-desktop')).default;
      const buffer = await screenshotDesktop({ format: 'png' });
      writeFileSync(screenshotPath, buffer);
    } catch (ssErr) {
      return {
        screenshotPath: null, processExitCode: null, stdout: '', stderr: '',
        error: `Screenshot capture failed: ${ssErr instanceof Error ? ssErr.message : String(ssErr)}`,
      };
    }

    try { appProcess.kill('SIGTERM'); } catch {}

    const result = await appProcess;
    return {
      screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
      processExitCode: result.exitCode ?? null,
      stdout: result.stdout?.slice(-2000) ?? '',
      stderr: result.stderr?.slice(-2000) ?? '',
    };

  } catch (err) {
    try { appProcess?.kill('SIGTERM'); } catch {}
    return {
      screenshotPath: null, processExitCode: null, stdout: '', stderr: '',
      error: `Desktop verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
