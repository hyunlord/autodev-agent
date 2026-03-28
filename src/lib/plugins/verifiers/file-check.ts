import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function runFileCheck(
  filePath: string,
  cwd: string,
  expectedText?: string,
): { passed: boolean; actual: string; durationMs: number } {
  const start = Date.now();
  const fullPath = join(cwd, filePath);

  if (!existsSync(fullPath)) {
    return { passed: false, actual: `File not found: ${filePath}`, durationMs: Date.now() - start };
  }

  if (expectedText) {
    const content = readFileSync(fullPath, 'utf-8');
    const found = content.includes(expectedText);
    return {
      passed: found,
      actual: found ? 'Content found' : `Expected text not found in ${filePath}`,
      durationMs: Date.now() - start,
    };
  }

  return { passed: true, actual: `File exists: ${filePath}`, durationMs: Date.now() - start };
}
