import { existsSync, readFileSync } from 'fs';
import { join, isAbsolute } from 'path';

export function runFileCheck(
  filePath: string,
  cwd: string,
  expectedText?: string,
): { passed: boolean; actual: string; durationMs: number } {
  const start = Date.now();

  // Fix: absolute path → use directly. Relative → join with cwd.
  let fullPath: string;
  if (isAbsolute(filePath)) {
    fullPath = filePath;
  } else {
    fullPath = join(cwd, filePath);
  }

  // Fallback: strip cwd prefix if filePath contains it (double-join guard)
  if (!existsSync(fullPath) && filePath.includes(cwd)) {
    const stripped = filePath.replace(cwd, '').replace(/^\//, '');
    fullPath = join(cwd, stripped);
  }

  // Last resort: filename only
  if (!existsSync(fullPath)) {
    const basename = filePath.split('/').pop() ?? filePath;
    const basenameFullPath = join(cwd, basename);
    if (existsSync(basenameFullPath)) {
      fullPath = basenameFullPath;
    }
  }

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
