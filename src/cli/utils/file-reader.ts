import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { load as yamlLoad } from 'js-yaml';

export type FileReadResult =
  | { ok: true; data: unknown; absPath: string }
  | { ok: false; error: string; absPath: string };

export function readYamlFile(path: string): FileReadResult {
  const absPath = resolve(path);
  if (!existsSync(absPath)) {
    return { ok: false, error: '파일을 찾을 수 없습니다', absPath };
  }
  try {
    const raw = readFileSync(absPath, 'utf-8');
    const data = yamlLoad(raw);
    return { ok: true, data, absPath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `YAML 파싱 실패: ${msg}`, absPath };
  }
}
