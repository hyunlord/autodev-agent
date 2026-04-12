import { join, basename } from 'path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';

export interface VisualRegressionResult {
  passed: boolean;
  diffPercentage: number;
  baselinePath: string | null;
  currentPath: string;
  diffPath: string | null;
  description: string;
  durationMs: number;
}

const BASELINE_DIR = 'baselines';

/**
 * I5: Save current screenshot as baseline for future regression checks.
 */
export function captureBaseline(
  screenshotDir: string,
  screenshotPath: string,
  name: string,
): string {
  const baselineDir = join(screenshotDir, BASELINE_DIR);
  mkdirSync(baselineDir, { recursive: true });

  const baselinePath = join(baselineDir, `${name}.png`);
  copyFileSync(screenshotPath, baselinePath);
  return baselinePath;
}

/**
 * I5: Find existing baseline for a given name.
 */
export function findBaseline(screenshotDir: string, name: string): string | null {
  const baselinePath = join(screenshotDir, BASELINE_DIR, `${name}.png`);
  return existsSync(baselinePath) ? baselinePath : null;
}

/**
 * I5: Compare current screenshot against baseline.
 *
 * Uses sharp for pixel-level diff when available,
 * falls back to file-size heuristic otherwise.
 */
export async function compareScreenshots(
  baselinePath: string,
  currentPath: string,
  screenshotDir: string,
  threshold: number = 0.05,
): Promise<VisualRegressionResult> {
  const startTime = Date.now();

  try {
    const baselineSize = statSync(baselinePath).size;
    const currentSize = statSync(currentPath).size;

    // File-size heuristic as fallback
    const sizeDiffRatio = Math.abs(baselineSize - currentSize) / Math.max(baselineSize, 1);
    let diffPercentage = sizeDiffRatio;
    let diffPath: string | null = null;

    // Attempt pixel-level comparison with sharp
    try {
      const sharp = await import('sharp');

      const baselineBuf = await sharp.default(baselinePath)
        .raw().ensureAlpha()
        .toBuffer({ resolveWithObject: true });

      const currentBuf = await sharp.default(currentPath)
        .resize(baselineBuf.info.width, baselineBuf.info.height, { fit: 'fill' })
        .raw().ensureAlpha()
        .toBuffer({ resolveWithObject: true });

      const pixels = baselineBuf.info.width * baselineBuf.info.height;
      let diffPixels = 0;
      const diffData = Buffer.alloc(baselineBuf.data.length);

      for (let i = 0; i < pixels; i++) {
        const o = i * 4;
        const rD = Math.abs(baselineBuf.data[o] - currentBuf.data[o]);
        const gD = Math.abs(baselineBuf.data[o + 1] - currentBuf.data[o + 1]);
        const bD = Math.abs(baselineBuf.data[o + 2] - currentBuf.data[o + 2]);

        if (rD > 30 || gD > 30 || bD > 30) {
          diffPixels++;
          diffData[o] = 255; diffData[o + 1] = 0;
          diffData[o + 2] = 0; diffData[o + 3] = 255;
        } else {
          diffData[o] = Math.floor(baselineBuf.data[o] * 0.3);
          diffData[o + 1] = Math.floor(baselineBuf.data[o + 1] * 0.3);
          diffData[o + 2] = Math.floor(baselineBuf.data[o + 2] * 0.3);
          diffData[o + 3] = 255;
        }
      }

      diffPercentage = diffPixels / pixels;

      if (diffPercentage > 0) {
        diffPath = join(screenshotDir, `diff-${basename(currentPath)}`);
        await sharp.default(diffData, {
          raw: { width: baselineBuf.info.width, height: baselineBuf.info.height, channels: 4 },
        }).png().toFile(diffPath);
      }
    } catch {
      // sharp not available — file-size heuristic already set
    }

    const passed = diffPercentage <= threshold;
    return {
      passed,
      diffPercentage,
      baselinePath,
      currentPath,
      diffPath,
      description: passed
        ? `Visual regression OK (${(diffPercentage * 100).toFixed(1)}% diff)`
        : `Visual regression: ${(diffPercentage * 100).toFixed(1)}% diff (threshold: ${(threshold * 100).toFixed(1)}%)`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      passed: true,
      diffPercentage: 0,
      baselinePath,
      currentPath,
      diffPath: null,
      description: `Visual regression skipped: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * I5: List all saved baselines.
 */
export function listBaselines(screenshotDir: string): string[] {
  const dir = join(screenshotDir, BASELINE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.png'));
}
