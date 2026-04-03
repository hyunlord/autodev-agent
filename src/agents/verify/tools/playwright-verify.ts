import { join } from 'path';
import { mkdirSync } from 'fs';
import type { VerifyTool, VerifyToolResult } from '../../interfaces';

export function createPlaywrightTool(projectDir: string, screenshotDir: string): VerifyTool {
  return {
    name: 'playwright',
    description: 'Open a URL or file in browser, take screenshot, click elements. Params: { action: "screenshot"|"click"|"evaluate", url?: "http://...", file?: "index.html", selector?: "#btn", js?: "document.title" }',
    async execute(params): Promise<VerifyToolResult> {
      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        const url = (params.url as string) ?? (params.file ? `file://${join(projectDir, params.file as string)}` : null);
        if (!url) {
          await browser.close();
          return { success: false, output: 'No url or file provided' };
        }

        // Collect console errors before navigation
        const consoleErrors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout((params.waitMs as number) ?? 1000);

        let output = '';
        const data: Record<string, unknown> = { consoleErrors };

        if (params.action === 'screenshot' || !params.action) {
          mkdirSync(screenshotDir, { recursive: true });
          const ssPath = join(screenshotDir, `verify-${Date.now()}.png`);
          await page.screenshot({ path: ssPath, fullPage: true });
          output = `Screenshot saved: ${ssPath}`;
          data.screenshotPath = ssPath;
          data.pageText = await page.textContent('body').catch(() => '');
          data.title = await page.title().catch(() => '');
        }

        if (params.action === 'click' && params.selector) {
          await page.click(params.selector as string, { timeout: 5000 });
          await page.waitForTimeout(500);
          mkdirSync(screenshotDir, { recursive: true });
          const ssPath = join(screenshotDir, `after-click-${Date.now()}.png`);
          await page.screenshot({ path: ssPath });
          output = `Clicked ${params.selector}. Screenshot: ${ssPath}`;
          data.screenshotPath = ssPath;
          data.pageText = await page.textContent('body').catch(() => '');
        }

        if (params.action === 'evaluate' && params.js) {
          const result = await page.evaluate(params.js as string);
          output = `JS result: ${JSON.stringify(result)}`;
          data.jsResult = result;
        }

        await browser.close();
        return { success: true, output, data };
      } catch (err) {
        return { success: false, output: `Playwright error: ${err}` };
      }
    },
  };
}
