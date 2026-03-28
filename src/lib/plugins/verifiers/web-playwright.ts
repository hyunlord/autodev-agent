import { chromium, type Browser, type Page } from 'playwright';
import type { ResultPromise } from 'execa';
import waitOn from 'wait-on';
import treeKill from 'tree-kill';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export interface WebVerifyOptions {
  projectDir: string;
  devCmd: string;
  port: number;
  screenshotDir: string;
  installCmd?: string;
}

export interface WebVerifyContext {
  page: Page;
  browser: Browser;
  serverProcess: ResultPromise;
  consoleErrors: string[];
  screenshotDir: string;
  port: number;
}

export async function startWebApp(opts: WebVerifyOptions): Promise<WebVerifyContext> {
  const { execa } = await import('execa');

  if (!existsSync(opts.screenshotDir)) {
    mkdirSync(opts.screenshotDir, { recursive: true });
  }

  if (opts.installCmd) {
    await execa('sh', ['-c', opts.installCmd], {
      cwd: opts.projectDir,
      reject: false,
      timeout: 120_000,
    });
  }

  const serverProcess = execa('sh', ['-c', opts.devCmd], {
    cwd: opts.projectDir,
    reject: false,
    env: { ...process.env, PORT: String(opts.port), BROWSER: 'none' },
  });

  try {
    await waitOn({
      resources: [`tcp:127.0.0.1:${opts.port}`],
      timeout: 60_000,
    });
  } catch {
    if (serverProcess.pid) {
      treeKill(serverProcess.pid, 'SIGTERM');
    }
    throw new Error(`Dev server did not start on port ${opts.port} within 60s`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  return { page, browser, serverProcess, consoleErrors, screenshotDir: opts.screenshotDir, port: opts.port };
}

export async function captureScreenshot(
  ctx: WebVerifyContext,
  label: string,
): Promise<string> {
  const filename = `${label}-${nanoid(6)}.png`;
  const filepath = join(ctx.screenshotDir, filename);
  await ctx.page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

export async function navigateAndScreenshot(
  ctx: WebVerifyContext,
  path: string = '/',
  label: string = 'page',
): Promise<{ screenshotPath: string; statusCode: number }> {
  const url = `http://localhost:${ctx.port}${path}`;
  const response = await ctx.page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  const statusCode = response?.status() ?? 0;
  const screenshotPath = await captureScreenshot(ctx, label);
  return { screenshotPath, statusCode };
}

export async function runDomCheck(
  ctx: WebVerifyContext,
  selector?: string,
  expectedText?: string,
): Promise<{ passed: boolean; actual: string }> {
  if (selector) {
    try {
      const element = await ctx.page.waitForSelector(selector, { timeout: 5_000 });
      if (!element) {
        return { passed: false, actual: `Selector not found: ${selector}` };
      }
      if (expectedText) {
        const text = await element.textContent();
        const found = text?.includes(expectedText) ?? false;
        return {
          passed: found,
          actual: found ? `Found "${expectedText}"` : `Text "${expectedText}" not in element (got: "${text?.slice(0, 100)}")`,
        };
      }
      return { passed: true, actual: `Selector found: ${selector}` };
    } catch {
      return { passed: false, actual: `Selector timeout: ${selector}` };
    }
  }

  if (expectedText) {
    const bodyText = await ctx.page.textContent('body');
    const found = bodyText?.includes(expectedText) ?? false;
    return {
      passed: found,
      actual: found ? `Page contains "${expectedText}"` : `Page does not contain "${expectedText}"`,
    };
  }

  return { passed: true, actual: 'No assertions specified' };
}

export async function cleanupWebApp(ctx: WebVerifyContext): Promise<void> {
  try {
    await ctx.browser.close();
  } catch { /* ignore */ }

  if (ctx.serverProcess.pid) {
    await new Promise<void>((resolve) => {
      treeKill(ctx.serverProcess.pid!, 'SIGTERM', () => resolve());
    });
  }
}
